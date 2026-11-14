/**
 * didja.dev/compare (SCR-113): Didja next to other apps that read your screen, on the questions that
 * matter for privacy. Every cell about another app says only what that app's own documentation says,
 * and cites it (`sources`, each with the date it was read). Where its documentation is silent the
 * cell says so instead of guessing. Didja's cells cite this repository's docs, and must stay true to
 * the code: engine/test/compare.test.ts checks the parts it can.
 *
 * Neutral on purpose: no ratings, no ticks and crosses, no logos, no other site's images or scripts.
 */

/** The day the competitors' pages below were read. Re-read them and change this when updating a cell. */
export const CHECKED = '2026-11-14';

export type Source = {
  /** Shown in the list of sources. */
  title: string;
  /** An https address on the product's own site, or for Didja a path in this repository. */
  url: string;
};

export type Product = {
  id: 'didja' | 'recall' | 'screenpipe' | 'chatgpt' | 'littlebird';
  name: string;
  /** Who makes it and where it runs, in a few words. */
  kind: string;
  /** Hosts its sources may be on (its own sites). Empty for Didja, whose sources are in the repository. */
  domains: string[];
  sources: Record<string, Source>;
};

export const products: Product[] = [
  {
    id: 'didja',
    name: 'Didja',
    kind: 'Mac menu bar app',
    domains: [],
    sources: {
      guide: { title: 'Didja: docs/GUIDE.md, "Privacy"', url: 'docs/GUIDE.md' },
      network: { title: 'Didja: docs/NETWORK.md', url: 'docs/NETWORK.md' },
      license: { title: 'Didja: LICENSE', url: 'LICENSE' },
      architecture: { title: 'Didja: docs/ARCHITECTURE.md', url: 'docs/ARCHITECTURE.md' },
    },
  },
  {
    id: 'recall',
    name: 'Microsoft Recall',
    kind: 'Windows 11, Copilot+ PCs',
    domains: ['support.microsoft.com', 'blogs.windows.com'],
    sources: {
      privacy: { title: 'Microsoft Support: Privacy and control over your Recall experience', url: 'https://support.microsoft.com/windows/d404f672-7647-41e5-886c-a3c59680af15' },
      security: { title: 'Windows Experience Blog: Update on Recall security and privacy architecture', url: 'https://blogs.windows.com/windowsexperience/2024/09/27/update-on-recall-security-and-privacy-architecture/' },
    },
  },
  {
    id: 'screenpipe',
    name: 'Screenpipe',
    kind: 'Mac, Windows and Linux app',
    domains: ['docs.screenpipe.com', 'github.com'],
    sources: {
      architecture: { title: 'Screenpipe docs: Architecture', url: 'https://docs.screenpipe.com/architecture' },
      dataflow: { title: 'Screenpipe docs: Privacy data flow', url: 'https://docs.screenpipe.com/privacy-data-flow' },
      recording: { title: 'Screenpipe docs: Choose what Screenpipe records', url: 'https://docs.screenpipe.com/recording-controls' },
      storage: { title: 'Screenpipe docs: Storage and retention', url: 'https://docs.screenpipe.com/storage-and-retention' },
      license: { title: 'Screenpipe on GitHub: LICENSE.md', url: 'https://github.com/screenpipe/screenpipe/blob/main/LICENSE.md' },
    },
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT Computer History',
    kind: 'ChatGPT for Mac, Pro, Business and Enterprise',
    domains: ['learn.chatgpt.com'],
    sources: {
      doc: { title: 'ChatGPT docs: Computer History', url: 'https://learn.chatgpt.com/docs/customization/computer-history' },
    },
  },
  {
    id: 'littlebird',
    name: 'Littlebird',
    kind: 'Mac app with a cloud service',
    domains: ['docs.littlebird.ai', 'littlebird.ai'],
    sources: {
      faq: { title: 'Littlebird docs: FAQ', url: 'https://docs.littlebird.ai/docs/faq/' },
      privacy: { title: 'Littlebird docs: Privacy and security', url: 'https://docs.littlebird.ai/docs/privacy-security/' },
      exclusions: { title: 'Littlebird docs: Context exclusions', url: 'https://docs.littlebird.ai/docs/exclusions/' },
      facts: { title: 'Littlebird: Facts', url: 'https://littlebird.ai/facts' },
    },
  },
];

/** One cell: what the product's documentation says, and which of its sources say it. */
export type Cell = { text: string; cite: string[] };

export type Row = {
  id: 'screenshots' | 'processing' | 'retention' | 'telemetry' | 'licence' | 'encryption' | 'exclusions' | 'done';
  question: string;
  cells: Record<Product['id'], Cell>;
};

/** The words a cell uses when the cited documentation does not answer the question. */
export const NOT_STATED = 'Not stated in the pages cited.';

export const rows: Row[] = [
  {
    id: 'screenshots',
    question: 'Stores screenshots?',
    cells: {
      didja: { text: 'No. It reads the text of the window in front through Accessibility. For apps that hide their text, an optional OCR fallback reads a frame in memory and drops it.', cite: ['guide'] },
      recall: { text: 'Yes, once you opt in: it saves snapshots of your screen on the PC.', cite: ['privacy'] },
      screenpipe: { text: 'Yes: JPEG frames, saved under ~/.screenpipe/data, with the text in a local SQLite database.', cite: ['architecture'] },
      chatgpt: { text: 'No. It records a stream of interaction events, not screenshots or audio.', cite: ['doc'] },
      littlebird: { text: 'It reads window text. When a window\'s text cannot be read, it captures an image of the window, turns it into text and deletes the image.', cite: ['faq', 'facts'] },
    },
  },
  {
    id: 'processing',
    question: 'Where is it processed?',
    cells: {
      didja: { text: "On your Mac: Apple's on-device model, or a model you run yourself in Ollama on the same Mac if you turn that on.", cite: ['guide', 'network'] },
      recall: { text: 'On the PC. Microsoft says no internet connection is used to save or analyse snapshots.', cite: ['privacy'] },
      screenpipe: { text: 'Stored on your machine by default. If you chat with a cloud AI provider, the context you select is sent to it.', cite: ['architecture', 'dataflow'] },
      chatgpt: { text: "Event files are made on the Mac and processed on OpenAI's servers to write memories.", cite: ['doc'] },
      littlebird: { text: 'It runs on your computer and stores the context it builds in the AWS cloud (US East).', cite: ['faq', 'privacy'] },
    },
  },
  {
    id: 'retention',
    question: 'How long is it kept?',
    cells: {
      didja: { text: 'Captured text: 24 hours at most (or 1 or 6 hours). A few lines stay with each open task until it is done or dismissed.', cite: ['guide'] },
      recall: { text: 'You choose how long, and how much disk; the oldest snapshots are deleted when the limit is reached.', cite: ['privacy'] },
      screenpipe: { text: 'You set a retention window in its storage settings. The docs give no default.', cite: ['storage'] },
      chatgpt: { text: 'Event files up to 48 hours on the Mac; memory files until you delete them.', cite: ['doc'] },
      littlebird: { text: 'No period stated. You can delete the last hour, the last day, all context, or your account.', cite: ['faq', 'facts'] },
    },
  },
  {
    id: 'telemetry',
    question: 'What it sends about you',
    cells: {
      didja: { text: "No analytics. One update check a day to didja.dev that carries only the app's name and version (can be turned off); task tools only if you connect them.", cite: ['network'] },
      recall: { text: 'Snapshots are not shared with Microsoft. Some Windows diagnostic data may be sent, depending on your privacy settings.', cite: ['privacy'] },
      screenpipe: { text: `${NOT_STATED} Logs leave the machine only when you send them.`, cite: ['dataflow'] },
      chatgpt: { text: 'Event files go to OpenAI to be processed; OpenAI says it does not keep them afterwards or train on them.', cite: ['doc'] },
      littlebird: { text: 'Context is stored in its cloud; it says your data is not used for training or sold.', cite: ['faq', 'privacy'] },
    },
  },
  {
    id: 'licence',
    question: 'Licence',
    cells: {
      didja: { text: 'MIT, open source.', cite: ['license'] },
      recall: { text: 'Part of Windows 11.', cite: ['privacy'] },
      screenpipe: { text: 'Screenpipe Commercial License: source available, free for personal and non-commercial use; commercial use needs a paid licence.', cite: ['license'] },
      chatgpt: { text: 'Part of the ChatGPT app.', cite: ['doc'] },
      littlebird: { text: NOT_STATED, cite: ['faq'] },
    },
  },
  {
    id: 'encryption',
    question: 'Encrypted on disk?',
    cells: {
      didja: { text: 'Captured screen text is sealed with AES-256-GCM; the key is kept in your login Keychain.', cite: ['guide'] },
      recall: { text: 'Yes: snapshots and their index are always encrypted, with keys protected by the TPM and Windows Hello.', cite: ['privacy', 'security'] },
      screenpipe: { text: `${NOT_STATED} The local database is SQLite.`, cite: ['architecture'] },
      chatgpt: { text: 'The event files are not encrypted by Computer History; they sit in the ChatGPT app\'s own container.', cite: ['doc'] },
      littlebird: { text: 'Yes, in its cloud: AES-256 at rest, TLS in transit.', cite: ['privacy', 'facts'] },
    },
  },
  {
    id: 'exclusions',
    question: 'What it never reads',
    cells: {
      didja: { text: 'Your exclude list applies before anything is read. Secure fields, password managers, card fields and private windows are never read; banks, payments and patient portals are excluded from the start.', cite: ['guide'] },
      recall: { text: 'Apps and websites you filter (sites in supported browsers), private browsing, and snapshots its sensitive-information filter catches (on by default).', cite: ['privacy'] },
      screenpipe: { text: 'Windows, apps and URLs you exclude. Its docs note that new exclusions do not remove what was recorded before.', cite: ['dataflow', 'recording'] },
      chatgpt: { text: 'Apps and websites you exclude (or only those you include), and private browsing.', cite: ['doc'] },
      littlebird: { text: 'Apps, sites and categories you exclude; password managers and password fields by default. Card numbers and API keys are redacted before they are stored.', cite: ['exclusions', 'privacy'] },
    },
  },
  {
    id: 'done',
    question: 'Notices when a task gets done?',
    cells: {
      didja: { text: 'Yes, that is what it is for: it ticks a task off when it sees it done, and asks when it is not sure.', cite: ['guide', 'architecture'] },
      recall: { text: 'Not described in its documentation.', cite: ['privacy'] },
      screenpipe: { text: 'Not described in its documentation.', cite: ['dataflow'] },
      chatgpt: { text: 'Not described in its documentation.', cite: ['doc'] },
      littlebird: { text: 'It can mark a task complete in a connected app when you ask; detecting it on its own is not described.', cite: ['facts'] },
    },
  },
];

export const page = {
  title: 'Didja compared — screenshots, cloud, retention, encryption',
  description: 'How Didja compares with Microsoft Recall, Screenpipe, ChatGPT Computer History and Littlebird on screenshots, where processing happens, retention, licence and encryption. Every cell cites the product\'s own documentation.',
  eyebrow: 'COMPARE',
  heading: 'Apps that read your screen, side by side.',
  lead: "Each of these reads what is on your screen, for different jobs: Recall and Computer History help you find or remember what you did, Screenpipe records it for your own tools, Littlebird gives an assistant context. Didja only looks for steps you haven't finished. Below is what each one's own documentation says about your data.",
  method: `Every cell about another product comes from that product's own pages, listed under Sources, as read on ${CHECKED}. Where they don't answer a question, the cell says so. Products change: if a cell is out of date, tell us and we will fix it.`,
  sourcesTitle: 'Sources',
  checked: `Read on ${CHECKED}.`,
  back: '← didja.dev',
};
