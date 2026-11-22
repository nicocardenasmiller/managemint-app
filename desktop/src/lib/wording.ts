// The app's wording comes from copy/wording.txt (the "desktop." lines). tr("topbar.today") returns one line of it.
// Edit the text there, not here. A key that isn't in the file throws, and `npm test` lists any that are missing.
import raw from "../../../copy/wording.txt?raw";
import { parseWording, wordingFor } from "../../../copy/wording.mjs";

export const tr = wordingFor(parseWording(raw), "desktop");
