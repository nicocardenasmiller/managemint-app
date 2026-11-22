export type Status = "todo" | "doing" | "done" | "cancelled";
export type Kind = "task" | "milestone";

export interface Project {
  id: string; name: string; color: string | null; description: string; keywords: string;
  status: "active" | "paused" | "done"; sort: number; calendar?: number; updated_at: string; deleted_at: string | null;
}
export interface Section { id: string; project_id: string; name: string; sort: number; updated_at: string; deleted_at: string | null }
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
}

export type TaskPatch = Partial<Pick<Task,
  "project_id" | "section_id" | "parent_id" | "title" | "notes" | "kind" | "status" | "start_date" | "due_date" |
  "due_time" | "deadline" | "duration_min" | "priority" | "sort" | "calendar">>;
