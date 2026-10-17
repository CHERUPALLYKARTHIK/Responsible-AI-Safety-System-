import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function weakWeight(avg: number | null) {
  if (avg === null) return 1.15;
  if (avg < 60) return 2.4;
  if (avg < 70) return 1.9;
  if (avg < 80) return 1.5;
  if (avg < 90) return 1.2;
  return 1.0;
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const body = await req.json();
    const action = body?.action;
    const studentId = String(body?.studentId || "").trim();
    if (!studentId) return json({ error: "studentId is required" }, 400);

    if (action === "generate") {
      const requested = Number(body?.count || 50);
      const count = [30, 50, 75].includes(requested) ? requested : 50;

      const { data: questions, error: qErr } = await supabase
        .from("questions")
        .select("*")
        .order("week");
      if (qErr) throw qErr;
      if (!questions || questions.length < count) return json({ error: "Question bank is too small" }, 500);

      const { data: perfRows, error: pErr } = await supabase
        .from("week_performance")
        .select("week,correct_count,total_count")
        .eq("student_id", studentId);
      if (pErr) throw pErr;

      const perf = new Map<number, number | null>();
      for (let w = 1; w <= 12; w++) perf.set(w, null);
      for (const row of perfRows || []) {
        perf.set(row.week, row.total_count ? Math.round((row.correct_count / row.total_count) * 100) : null);
      }

      const { data: recentExams, error: reErr } = await supabase
        .from("exams")
        .select("id")
        .eq("student_id", studentId)
        .order("created_at", { ascending: false })
        .limit(3);
      if (reErr) throw reErr;
      const recentExamIds = (recentExams || []).map((x) => x.id);
      const recentQuestionIds = new Set<string>();
      if (recentExamIds.length) {
        const { data: recentQs, error: rqErr } = await supabase
          .from("exam_questions")
          .select("question_id")
          .in("exam_id", recentExamIds);
        if (rqErr) throw rqErr;
        for (const row of recentQs || []) recentQuestionIds.add(row.question_id);
      }

      const weeks = Array.from({ length: 12 }, (_, i) => i + 1);
      const byWeek = new Map<number, any[]>();
      for (const w of weeks) byWeek.set(w, []);
      for (const q of questions) byWeek.get(q.week)!.push(q);

      let created: { examId: string; selected: any[]; orders: number[][] } | null = null;
      for (let attempt = 0; attempt < 30 && !created; attempt++) {
        const minEach = count >= 24 ? 2 : 1;
        const quotas = new Map<number, number>();
        for (const w of weeks) quotas.set(w, Math.min(minEach, byWeek.get(w)!.length));
        let remaining = count - [...quotas.values()].reduce((a, b) => a + b, 0);
        const cap = Math.max(minEach, Math.floor(count * 0.20));

        while (remaining > 0) {
          const candidates = weeks.filter((w) => quotas.get(w)! < Math.min(cap, byWeek.get(w)!.length));
          if (!candidates.length) break;
          const weighted = candidates.map((w) => ({ w, weight: weakWeight(perf.get(w) ?? null) }));
          const total = weighted.reduce((a, x) => a + x.weight, 0);
          let roll = Math.random() * total;
          let chosen = weighted[weighted.length - 1].w;
          for (const x of weighted) {
            roll -= x.weight;
            if (roll <= 0) { chosen = x.w; break; }
          }
          quotas.set(chosen, quotas.get(chosen)! + 1);
          remaining--;
        }

        const selected: any[] = [];
        for (const w of weeks) {
          const quota = quotas.get(w)!;
          const pool = byWeek.get(w)!;
          const assignments = pool.filter((q) => q.source === "assignment");
          const newQs = pool.filter((q) => q.source !== "assignment");
          const chosen: any[] = [];
          const chosenIds = new Set<string>();

          const take = (list: any[], n: number) => {
            const fresh = shuffle(list.filter((q) => !chosenIds.has(q.id) && !recentQuestionIds.has(q.id)));
            const repeats = shuffle(list.filter((q) => !chosenIds.has(q.id) && recentQuestionIds.has(q.id)));
            for (const q of [...fresh, ...repeats].slice(0, n)) { chosen.push(q); chosenIds.add(q.id); }
          };

          take(assignments, Math.min(assignments.length, Math.ceil(quota * 0.75)));
          take(newQs, quota - chosen.length);
          take(pool, quota - chosen.length);
          selected.push(...chosen);
        }

        if (selected.length < count) {
          const ids = new Set(selected.map((q) => q.id));
          selected.push(...shuffle(questions.filter((q) => !ids.has(q.id))).slice(0, count - selected.length));
        }

        const mixed = shuffle(selected.slice(0, count));
        const fingerprint = await sha256(mixed.map((q) => q.id).sort().join("|"));
        const { data: exam, error: examErr } = await supabase
          .from("exams")
          .insert({ student_id: studentId, fingerprint, question_count: count })
          .select("id")
          .single();

        if (examErr) {
          if ((examErr as any).code === "23505") continue;
          throw examErr;
        }

        const orders = mixed.map((q) => q.type === "numeric" ? [] : shuffle(q.options.map((_: any, i: number) => i)));
        const rows = mixed.map((q, position) => ({
          exam_id: exam.id,
          position,
          question_id: q.id,
          option_order: orders[position],
        }));
        const { error: eqErr } = await supabase.from("exam_questions").insert(rows);
        if (eqErr) throw eqErr;
        created = { examId: exam.id, selected: mixed, orders };
      }

      if (!created) return json({ error: "Could not generate a globally unique exam after several attempts" }, 409);

      const safeQuestions = created.selected.map((q, i) => ({
        id: q.id,
        type: q.type,
        q: q.question_text,
        opts: q.type === "numeric" ? [] : created!.orders[i].map((idx) => q.options[idx]),
      }));
      return json({ examId: created.examId, questions: safeQuestions });
    }

    if (action === "submit") {
      const examId = String(body?.examId || "");
      const responses = body?.responses || {};
      if (!examId) return json({ error: "examId is required" }, 400);

      const { data: exam, error: eErr } = await supabase
        .from("exams")
        .select("id,student_id,submitted_at,question_count")
        .eq("id", examId)
        .eq("student_id", studentId)
        .single();
      if (eErr || !exam) return json({ error: "Exam not found" }, 404);
      if (exam.submitted_at) return json({ error: "Exam was already submitted" }, 409);

      const { data: eqRows, error: eqErr } = await supabase
        .from("exam_questions")
        .select("position,option_order,question:questions(*)")
        .eq("exam_id", examId)
        .order("position");
      if (eqErr) throw eqErr;

      let correct = 0;
      let unanswered = 0;
      const answerRows: any[] = [];
      const details: any[] = [];
      const weekStats: Record<string, { total: number; correct: number; topics: Record<string, number> }> = {};
      for (let w = 1; w <= 12; w++) weekStats[w] = { total: 0, correct: 0, topics: {} };

      for (const row of eqRows || []) {
        const q: any = row.question;
        const user = responses[String(row.position)];
        let ok = false;
        let missing = false;
        let correctDisplayIndexes: number[] = [];

        if (q.type === "numeric") {
          missing = user === undefined || user === null || String(user).trim() === "";
          const u = Number(user);
          ok = !missing && Number.isFinite(u) && Math.abs(u - Number(q.numeric_answer)) <= Number(q.tolerance || 0);
        } else {
          const selected: number[] = Array.isArray(user) ? user.map(Number).sort((a, b) => a - b) : [];
          missing = selected.length === 0;
          const order: number[] = row.option_order || [];
          const canonicalSelected = selected.map((displayIdx) => order[displayIdx]).sort((a, b) => a - b);
          const canonicalCorrect = (q.correct_answers || []).map(Number).sort((a: number, b: number) => a - b);
          ok = canonicalSelected.length === canonicalCorrect.length && canonicalSelected.every((v, idx) => v === canonicalCorrect[idx]);
          correctDisplayIndexes = order.map((orig, displayIdx) => canonicalCorrect.includes(orig) ? displayIdx : -1).filter((x) => x >= 0);
        }

        if (missing) unanswered++;
        if (ok) correct++;
        answerRows.push({ exam_id: examId, position: row.position, answer: user ?? null, is_correct: ok });

        const ws = weekStats[q.week];
        ws.total++;
        if (ok) ws.correct++;
        if (!ok) ws.topics[q.topic] = (ws.topics[q.topic] || 0) + 1;

        details.push({
          index: row.position,
          ok,
          user,
          q: {
            id: q.id,
            type: q.type,
            q: q.question_text,
            opts: q.type === "numeric" ? [] : (row.option_order || []).map((idx: number) => q.options[idx]),
            correctDisplayIndexes,
            numericAnswer: q.numeric_answer,
            ex: q.explanation,
            mem: q.memory_tip,
            week: q.week,
            topic: q.topic,
            source: q.source,
          },
        });
      }

      const pct = Math.round((correct / exam.question_count) * 100);
      const { error: aErr } = await supabase.from("exam_answers").insert(answerRows);
      if (aErr) throw aErr;
      const { error: uErr } = await supabase.from("exams").update({ submitted_at: new Date().toISOString(), score_pct: pct }).eq("id", examId);
      if (uErr) throw uErr;

      for (let w = 1; w <= 12; w++) {
        const s = weekStats[w];
        if (!s.total) continue;
        const { data: existing } = await supabase
          .from("week_performance")
          .select("attempts,correct_count,total_count")
          .eq("student_id", studentId)
          .eq("week", w)
          .maybeSingle();
        const row = existing
          ? { student_id: studentId, week: w, attempts: existing.attempts + 1, correct_count: existing.correct_count + s.correct, total_count: existing.total_count + s.total, updated_at: new Date().toISOString() }
          : { student_id: studentId, week: w, attempts: 1, correct_count: s.correct, total_count: s.total, updated_at: new Date().toISOString() };
        const { error: wpErr } = await supabase.from("week_performance").upsert(row, { onConflict: "student_id,week" });
        if (wpErr) throw wpErr;
      }

      return json({ result: { correct, unanswered, total: exam.question_count, pct, details, weekStats } });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : "Unexpected error" }, 500);
  }
});
