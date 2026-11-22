// Built-in PhD templates (docs/sharing-plan.md §5). Dates are day offsets from one anchor date (day 0), the same
// format as desktop/src/lib/templates.ts. Used two ways:
//  - migrations insert them into `templates`: 0003 added the first set; 0004 (scripts/gen-phd-templates.mjs) updates the
//    ones a user hasn't edited and adds new ones. Migrations never change, so later edits here need another migration;
//  - the onboarding prompt shows Claude their outlines as starting points.

type K = "task" | "milestone";
/** `from`..`due` is a window (the task's start and due date), so a step reads as "sometime in these weeks", not one
 *  exact day. Notes carry the typical range and the reason, from docs/research/phd-timelines.md. */
interface T { title: string; section: string; due: number | null; from?: number; kind?: K; deadline?: boolean; notes?: string }
export interface PhdTemplate { id: string; name: string; anchorLabel: string; sections: string[]; tasks: T[] }

export const PHD_TEMPLATES: PhdTemplate[] = [
  {
    id: "phd-paper", name: "Paper (seminar, second-year or field paper)", anchorLabel: "Submission deadline",
    sections: ["Research", "Writing", "Feedback", "Submission"],
    tasks: [
      { title: "Settle the question and design", section: "Research", from: -150, due: -120, notes: "Usually takes a month or so. A short memo to your advisor helps." },
      { title: "Literature and data", section: "Research", from: -135, due: -84 },
      { title: "Analysis", section: "Research", from: -100, due: -56, notes: "Usually the longest step; it often overlaps with writing." },
      { title: "Rough full draft", section: "Writing", due: -49, kind: "milestone", notes: "Rough is fine. Don't wait for it to be polished." },
      { title: "Send draft to advisor and readers", section: "Feedback", due: -45, notes: "Allow 3 to 4 weeks for comments on a paper-length draft." },
      { title: "Revise from feedback", section: "Writing", from: -21, due: -10 },
      { title: "Proofread, format and upload", section: "Submission", from: -7, due: -3 },
      { title: "Submit", section: "Submission", due: 0, kind: "milestone", deadline: true },
    ],
  },
  {
    id: "phd-rr", name: "Revise and resubmit (R&R)", anchorLabel: "Decision letter received",
    sections: ["Plan", "Revise", "Resubmit"],
    tasks: [
      { title: "Read the reviews, then set them aside for a few days", section: "Plan", from: 0, due: 4 },
      { title: "Response memo: every comment and what you'll do", section: "Plan", from: 4, due: 14 },
      { title: "Agree the plan with co-authors or advisor", section: "Plan", from: 10, due: 21 },
      { title: "New analyses", section: "Revise", from: 14, due: 60 },
      { title: "Rewrite the paper", section: "Revise", from: 40, due: 90 },
      { title: "Response letter", section: "Resubmit", from: 75, due: 100 },
      { title: "Final read by co-authors or advisor", section: "Resubmit", from: 100, due: 110 },
      { title: "Resubmit", section: "Resubmit", due: 120, kind: "milestone", notes: "Journals rarely set a hard limit; 2 to 4 months is common. Check the letter for a date. Most papers need 2 or more rounds." },
    ],
  },
  {
    id: "phd-chapter", name: "Dissertation chapter", anchorLabel: "Chapter to advisor",
    sections: ["Plan", "Draft", "Revise"],
    tasks: [
      { title: "Outline, and send it to your advisor", section: "Plan", from: -120, due: -100, notes: "A one-page outline early saves big rewrites later." },
      { title: "Sources, data and literature", section: "Plan", from: -110, due: -70 },
      { title: "Core analysis or argument", section: "Draft", from: -90, due: -45 },
      { title: "First full draft", section: "Draft", due: -30, kind: "milestone" },
      { title: "Revise structure and argument", section: "Revise", from: -28, due: -10 },
      { title: "Polish prose, figures and references", section: "Revise", from: -10, due: -3 },
      { title: "Send chapter to advisor", section: "Revise", due: 0, kind: "milestone", notes: "Advisors usually need 3 to 4 weeks for one chapter, about 2 months for a full dissertation." },
    ],
  },
  {
    id: "phd-quals", name: "Field exams (quals / comps)", anchorLabel: "Exam date",
    sections: ["Plan", "Reading", "Practice"],
    tasks: [
      { title: "Get the reading lists and past exams", section: "Plan", from: -180, due: -150, notes: "Most departments hold exams at the end of year 2 or start of year 3. Ask older students for past questions." },
      { title: "Make a loose weekly reading plan", section: "Plan", from: -150, due: -140 },
      { title: "First field: reading", section: "Reading", from: -140, due: -60 },
      { title: "Second field: reading", section: "Reading", from: -100, due: -30, notes: "Fields can overlap; a study group helps." },
      { title: "Practice answers", section: "Practice", from: -45, due: -14 },
      { title: "Mock exam", section: "Practice", due: -21, kind: "milestone", notes: "Optional: with a study group or an older student." },
      { title: "Review only, no new reading", section: "Practice", from: -7, due: -1 },
      { title: "Exam", section: "Practice", due: 0, kind: "milestone" },
    ],
  },
  {
    id: "phd-prospectus", name: "Prospectus", anchorLabel: "Prospectus defense",
    sections: ["Design", "Writing", "Committee"],
    tasks: [
      { title: "Question and research design sketch", section: "Design", from: -210, due: -150, notes: "Most departments expect the prospectus by the end of year 3. It often grows out of a field or second-year paper." },
      { title: "Literature review", section: "Writing", from: -170, due: -90 },
      { title: "Methods, data and IRB plan", section: "Design", from: -150, due: -75, notes: "If you'll work with people, apply to the IRB early: exempt review takes 1 to 3 weeks, full board 1 to 2 months, fieldwork abroad longer." },
      { title: "Full draft to advisor", section: "Writing", due: -56, kind: "milestone", notes: "Allow 3 to 4 weeks for comments." },
      { title: "Revise from advisor feedback", section: "Writing", from: -35, due: -21 },
      { title: "Send to committee", section: "Committee", due: -14, kind: "milestone", deadline: true, notes: "Departments usually want it 2 to 3 weeks before the defense; check your handbook." },
      { title: "Prepare the presentation", section: "Committee", from: -10, due: -2 },
      { title: "Defense", section: "Committee", due: 0, kind: "milestone" },
    ],
  },
  {
    id: "phd-conference", name: "Conference submission", anchorLabel: "Proposal deadline",
    sections: ["Proposal", "After acceptance"],
    tasks: [
      { title: "Pick the paper and section", section: "Proposal", from: -42, due: -28 },
      { title: "Draft the abstract", section: "Proposal", from: -28, due: -10 },
      { title: "Feedback from co-authors or advisor", section: "Proposal", from: -14, due: -5 },
      { title: "Submit the proposal", section: "Proposal", due: 0, kind: "milestone", deadline: true, notes: "Typical cycle: APSA mid-January (meeting early September), MPSA late October (April), ISA June 1 (March), SPSA September (January). Check this year's call." },
      { title: "Register and apply for travel funding", section: "After acceptance", due: null, notes: "Once accepted." },
      { title: "Send the full paper to the discussant", section: "After acceptance", due: null, notes: "Usually about 2 weeks before the meeting." },
      { title: "Book travel", section: "After acceptance", due: null },
    ],
  },
  {
    id: "phd-grant", name: "Grant or fellowship application", anchorLabel: "Application deadline",
    sections: ["Prepare", "Write", "Submit"],
    tasks: [
      { title: "Read the call and check eligibility", section: "Prepare", from: -70, due: -56, notes: "Funding programs change often (several national ones closed in 2025 and 2026). Confirm the call is open this year and that you're eligible at your stage." },
      { title: "Ask letter writers", section: "Prepare", from: -60, due: -42, notes: "Give at least 4 to 6 weeks, more for busy writers. Send your draft and the deadline." },
      { title: "Draft the research statement", section: "Write", from: -50, due: -28 },
      { title: "Budget and timeline", section: "Write", from: -35, due: -21 },
      { title: "Advisor feedback", section: "Write", from: -24, due: -14 },
      { title: "Revise", section: "Write", from: -14, due: -5 },
      { title: "Confirm letters are in", section: "Submit", due: -7 },
      { title: "Submit", section: "Submit", due: -2, kind: "milestone", notes: "A couple of days early, in case the portal acts up." },
      { title: "Application deadline", section: "Submit", due: 0, kind: "milestone", deadline: true },
    ],
  },
  {
    id: "phd-teaching", name: "Teaching a section (semester)", anchorLabel: "First class",
    sections: ["Setup", "Weekly", "Grading"],
    tasks: [
      { title: "Read the syllabus and set up the course site", section: "Setup", from: -10, due: -3 },
      ...Array.from({ length: 14 }, (_, i): T => ({ title: `Prep section, week ${i + 1}`, section: "Weekly", due: i * 7 - 1 })),
      { title: "Midterm grading", section: "Grading", from: 49, due: 60, notes: "Plan less research work these weeks." },
      { title: "Final grading", section: "Grading", from: 98, due: 104 },
      { title: "Final grades due", section: "Grading", due: 105, kind: "milestone", deadline: true, notes: "Usually a few days to a week after the final exam; check the registrar's date." },
    ],
  },
  {
    id: "phd-jobmarket", name: "Job market packet", anchorLabel: "First application deadline",
    sections: ["Materials", "Letters", "Applications"],
    tasks: [
      { title: "Job market paper: full draft", section: "Materials", due: -150, kind: "milestone", notes: "Early deadlines are usually in August and September, so many students aim for spring of the market year." },
      { title: "Talk to letter writers about going on the market", section: "Letters", from: -150, due: -120 },
      { title: "Update CV", section: "Materials", from: -100, due: -60 },
      { title: "Research statement", section: "Materials", from: -100, due: -50 },
      { title: "Teaching statement and evidence", section: "Materials", from: -90, due: -40 },
      { title: "Formal request to letter writers, with your materials", section: "Letters", from: -60, due: -45, notes: "1 to 2 months before the first deadline." },
      { title: "Personal website", section: "Materials", from: -60, due: -30 },
      { title: "Confirm letters are uploaded", section: "Letters", due: -10 },
      { title: "First application deadline", section: "Applications", due: 0, kind: "milestone", deadline: true },
      { title: "Practice the job talk", section: "Applications", from: 0, due: 45, notes: "Campus visits usually come later in the fall and winter." },
    ],
  },
  {
    id: "phd-ma-thesis", name: "MA thesis", anchorLabel: "Final thesis due",
    sections: ["Plan", "Research", "Writing", "Submission"],
    tasks: [
      { title: "Find an advisor and second reader", section: "Plan", from: -240, due: -200, notes: "MA theses usually take two to three terms, from proposal to final." },
      { title: "Proposal", section: "Plan", from: -220, due: -180 },
      { title: "IRB approval, if you work with people", section: "Plan", from: -190, due: -160, notes: "Exempt review takes 1 to 3 weeks, full board 1 to 2 months." },
      { title: "Research and analysis", section: "Research", from: -180, due: -80 },
      { title: "First full draft to advisor and reader", section: "Writing", due: -60, kind: "milestone", notes: "Programs put this 3 to 8 weeks before the final; earlier is safer." },
      { title: "Revise from feedback", section: "Writing", from: -45, due: -21 },
      { title: "Format check for the graduate school", section: "Submission", from: -21, due: -10, notes: "Format review can take a few rounds." },
      { title: "Final thesis due", section: "Submission", due: 0, kind: "milestone", deadline: true },
    ],
  },
];

/** The body_json format of desktop/src/lib/templates.ts (TemplateBody v1). */
export function templateBody(t: PhdTemplate) {
  const skey = new Map(t.sections.map((s, i) => [s, `s${i + 1}`]));
  return {
    v: 1, anchorLabel: t.anchorLabel,
    sections: t.sections.map((s) => ({ key: skey.get(s)!, name: s })),
    tasks: t.tasks.map((x, i) => ({
      key: `t${i + 1}`, title: x.title, notes: x.notes ?? "", kind: x.kind ?? "task", section: skey.get(x.section) ?? null, parent: null,
      priority: 4, start: x.from ?? null, due: x.deadline ? null : x.due, deadline: x.deadline ? x.due : null, due_time: null,
    })),
    deps: [] as Array<[string, string]>,
  };
}

/** Short outlines for the onboarding prompt. */
export function templateOutlines(): string {
  return PHD_TEMPLATES.map((t) =>
    `### ${t.name} (day 0 = ${t.anchorLabel})\nSections: ${t.sections.join(", ")}\n` +
    t.tasks.map((x) => `- ${x.title}${x.due === null ? " (no date)" : x.from !== undefined ? ` (days ${x.from} to ${x.due})` : ` (day ${x.due})`}${x.kind === "milestone" ? " [milestone]" : ""}${x.deadline ? " [deadline]" : ""}${x.notes ? `: ${x.notes}` : ""}`).join("\n"),
  ).join("\n\n");
}
