export type Wording = Record<string, string>;
export type Vars = Record<string, string | number>;
export function parseWording(source: string): Wording;
export function fill(text: string, vars?: Vars): string;
export function wordingFor(all: Wording, prefix: string): (key: string, vars?: Vars) => string;
export function renderPage(html: string, all: Wording): string;
