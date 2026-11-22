// The app's wording comes from copy/wording.txt (bundled as text, see wrangler.toml [[rules]]).
// w("setup.title") returns one line of it; edit the text there, not here.
import raw from "../../copy/wording.txt";
import { parseWording, wordingFor } from "../../copy/wording.mjs";

export const WORDING = parseWording(raw);
/** Setup page and pairing page (/setup, /pair). */
export const setupWording = wordingFor(WORDING, "setup");
/** Messages the server sends back that people see on the setup page and in the apps. */
export const serverWording = wordingFor(WORDING, "server");
