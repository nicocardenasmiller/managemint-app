export type Status = "todo" | "doing" | "done" | "cancelled";
export type Kind = "task" | "milestone";

export interface Project {
  id: string; name: string; color: string | null; description: string; keywords: string;
  status: "active" | "paused" | "done"; sort: number; calendar?: number; updated_at: string; deleted_at: string | null;
}
export interface Section { id: string; project_id: string; name: string; sort: number; updated_at: string; deleted_at: string | null }
export interface Daily {
  id: string; title: string; sort: number; created_at: string; updated_at: string; deleted_at: string | null;
  /** Mon..Sun, "1" = due that day. */ days?: string;
  /** N times a week on any day (then `days` is ignored). */ per_week?: number | null;
  /** JSON [[from, to|null], ...] local dates. */ pauses?: string;
  /** Accent name (lib/accents.ts), or null to follow the theme colour. */ color?: string | null;
}
export type DailyPatch = Partial<Pick<Daily, "title" | "sort" | "days" | "per_week" | "color">> & { pauses?: Array<[string, string | null]> };
export interface DailyCheck { daily_id: string; date: string; done: number; updated_at: string }
export interface Task {
  id: string; project_id: string; section_id: string | null; parent_id: string | null;
  title: string; notes: string; kind: Kind; status: Status;
  start_date: string | null; due_date: string | null; due_time: string | null; deadline: string | null;
  duration_min: number | null; priority: number; sort: number; calendar?: number; source: "voice" | "manual" | "template";
  capture_id: string | null; created_at: string; updated_at: string; completed_at: string | null; deleted_at: string | null;
}
export interface Dep { task_id: string; depends_on_id: string }

/** What /capture returns: a card the user confirms before saving. */
export interface DraftTask {
  title: string; notes: string; project_id: string; kind: Kind;
  start_date: string | null; due_date: string | null; due_time: string | null; deadline: string | null;
  date_phrase: string; confidence: number; priority?: number;
  /** Set (with project_id "new") when the speaker asked for a new project; saving creates it. */
  new_project?: string;
}

export type TaskPatch = Partial<Pick<Task,
  "project_id" | "section_id" | "parent_id" | "title" | "notes" | "kind" | "status" | "start_date" | "due_date" |
  "due_time" | "deadline" | "duration_min" | "priority" | "sort" | "calendar">>;
