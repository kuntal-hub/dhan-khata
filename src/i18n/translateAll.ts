/**
 * `translate` with BOTH dictionaries registered synchronously. Use it where a language other
 * than the UI's may be needed immediately: server code (push digest, manifest), print pages
 * (receipt language setting), WhatsApp templates, tests. Never import it from modules on the
 * Home route: the I18nProvider loads English lazily there.
 */
import { en } from "./en";
import { registerDictionary } from "./translate";

registerDictionary("en", en);

export { translate } from "./translate";
