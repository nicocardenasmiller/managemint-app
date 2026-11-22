// View state that isn't data: where you are, what's selected, what's open. Remembered per computer.
export type Scope = "inbox" | "today" | "upcoming" | "all" | `p:${string}`;
export type View = "timeline" | "board" | "list";
export type Zoom = "week" | "month" | "quarter" | "semester";
export const ZOOM_PX: Record<Zoom, number> = { week: 48, month: 16, quarter: 6, semester: 3 };
export const ZOOMS: Zoom[] = ["week", "month", "quarter", "semester"];

const KEY = "managemint.ui.v1";

function load(): Partial<UiState> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { return {}; }
}

interface UiState { scope: Scope; views: Record<string, View>; zoom: Zoom; theme: "system" | "light" | "dark"; sidebar: boolean; collapsed: Record<string, boolean>; hideOldDone: boolean; listGroup: "project" | "date" }

class Ui {
  scope = $state<Scope>("all");
  views = $state<Record<string, View>>({});
  zoom = $state<Zoom>("month");
  theme = $state<UiState["theme"]>("system");
  sidebar = $state(true);
  collapsed = $state<Record<string, boolean>>({});
  hideOldDone = $state(true);
  listGroup = $state<UiState["listGroup"]>("project");

  selected = $state<string | null>(null);
  panel = $state(false);
  quickAdd = $state(false);
  palette = $state(false);
  help = $state(false);
  newProject = $state(false);
  /** First-run welcome and guided project setup (components/Onboarding.svelte). */
  onboarding = $state(false);
  /** The user's planning notes for the assistant (components/Guidelines.svelte). */
  guidelines = $state(false);
  /** The private calendar link for Apple/Google/Outlook (components/CalendarFeed.svelte). */
  calendarFeed = $state(false);
  /** Templates dialog: "use" (new project from a template) or a project id to save as a template. */
  templates = $state<null | "use" | { save: string }>(null);
  /** Project id whose delete dialog is open. */
  deleteProject = $state<string | null>(null);
  /** Bumped to ask the timeline to scroll to today. */
  scrollToToday = $state(0);
  /** Ask the timeline to scroll to a date (e.g. a new project's first task). */
  scrollTo = $state<{ date: string } | null>(null);
  /** Project id that the timeline shows alone (F = focus), others dimmed. */
  focus = $state<string | null>(null);
  /** Task ids in on-screen order, set by the current view, for J / K. */
  order: string[] = [];

  constructor() {
    const s = load();
    if (s.scope) this.scope = s.scope;
    if (s.views) this.views = s.views;
    if (s.zoom) this.zoom = s.zoom;
    if (s.theme) this.theme = s.theme;
    if (s.sidebar !== undefined) this.sidebar = s.sidebar;
    if (s.collapsed) this.collapsed = s.collapsed;
    if (s.hideOldDone !== undefined) this.hideOldDone = s.hideOldDone;
    if (s.listGroup) this.listGroup = s.listGroup;
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        scope: this.scope, views: this.views, zoom: this.zoom, theme: this.theme, sidebar: this.sidebar,
        collapsed: this.collapsed, hideOldDone: this.hideOldDone, listGroup: this.listGroup,
      }));
    } catch { /* ignore */ }
  }

  /** Inbox, Today and Upcoming are lists; projects and "All" remember their last view (timeline by default). */
  get view(): View {
    if (this.scope === "inbox" || this.scope === "today" || this.scope === "upcoming") return this.views[this.scope] ?? "list";
    return this.views[this.scope] ?? "timeline";
  }
  set view(v: View) { this.views[this.scope] = v; this.save(); }

  open(id: string) { this.selected = id; this.panel = true; }
  close() { this.panel = false; }
  go(scope: Scope) { this.scope = scope; this.save(); }
}

export const ui = new Ui();
