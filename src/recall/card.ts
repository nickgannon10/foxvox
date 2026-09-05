import DOMPurify from 'dompurify';
import renderMathInElement from 'katex/contrib/auto-render';
import katexStyles from 'katex/dist/katex.min.css';
import type { FilterDecision, Rating, RecallResponse, ReviewCard } from './types';

const style = `
:host{display:block!important;color-scheme:dark;contain:content;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e7e9ea;background:#000;font-size:15px;line-height:1.5;text-align:left}
*{box-sizing:border-box}button,textarea{font:inherit}button{cursor:pointer}button:disabled{cursor:default;opacity:.5}button:focus-visible,textarea:focus-visible{outline:2px solid #b9a9ff;outline-offset:3px}
.shell{padding:19px 20px 18px;border-bottom:1px solid #2f3336;background:linear-gradient(125deg,rgba(128,105,220,.085),transparent 60%)}
.top{display:flex;align-items:center;gap:9px;min-height:27px}.mark{display:grid;place-items:center;width:28px;height:28px;border:1px solid #6f5ca3;border-radius:9px;color:#cabaff;background:#211b35;font:600 18px Georgia,serif}.brand{font-weight:650;font-size:13px;letter-spacing:.01em}.pill{padding:2px 7px;border-radius:20px;font-size:10px;font-weight:600;letter-spacing:.055em;text-transform:uppercase;color:#b9a9f7;background:#211c30}.original{margin-left:auto;flex-shrink:0;border:0;background:transparent;color:#92969d;font-size:12px;padding:5px 0 5px 8px}.original:hover{color:#e7e9ea;text-decoration:underline}
.reason{margin:9px 0 20px;font-size:12px;line-height:1.5;color:#8d929b}.deck{margin-bottom:10px;color:#9e90c7;font-size:10px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;overflow-wrap:anywhere}.content{font-size:17px;line-height:1.6;overflow-wrap:anywhere;color:#eff0f4}.content> :first-child{margin-top:0}.content> :last-child{margin-bottom:0}.content p{margin:0 0 12px}.content h1,.content h2,.content h3{font-size:1.1em;line-height:1.4}.content pre{white-space:pre-wrap;padding:12px;background:#15131d;border-radius:8px;font-size:13px}.content table{display:block;max-width:100%;overflow:auto;border-collapse:collapse}.content td,.content th{padding:5px;border:1px solid #3d374b}.content hr{border:0;border-top:1px solid #3b3349;margin:18px 0}.content blockquote{border-left:2px solid #675583;padding-left:12px;margin-left:0;color:#bab0ce}.content .katex-display{overflow:auto hidden;padding:5px 0}.content .cloze{font-weight:600;color:#c5b5f5}.scratch-label{display:block;margin:18px 0 7px;font-size:12px;color:#a4a0af}.scratch{display:block;width:100%;min-height:72px;resize:vertical;padding:11px 12px;color:#dcd5ee;background:rgba(26,22,37,.6);border:1px solid #37303f;border-radius:10px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}.scratch::placeholder{color:#6e677f}.footer{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:22px}.button{border:1px solid #a390e0;border-radius:20px;background:#c0aff5;color:#1b142b;min-height:36px;padding:7px 18px;font-size:13px;font-weight:700;transition:background .15s}.button:hover{background:#d0c2fc}.muted-button{border:0;background:transparent;color:#84818e;font-size:12px;min-height:36px;padding:7px 0}.muted-button:hover{color:#d4cbeb}.hint{font-size:11px;color:#77727f}.grades{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-top:20px}.grade{min-height:39px;padding:8px 6px;border:1px solid #3b334b;border-radius:10px;background:#19151f;color:#cbc3dd;font-size:12px;font-weight:600}.grade:hover{background:#2b223b;border-color:#6c588f}.grade.good{background:#c0aff5;color:#21182e;border-color:#c0aff5}.status{margin:12px 0 0;font-size:12px;color:#b7a3db;min-height:0}.status:empty{display:none}.status.error{color:#f2a6aa}.saved{font-size:19px;font-weight:650;margin:1px 0 6px;color:#dfd5f8}.saved-subtitle,.pause{margin:0;color:#97919f;font-size:14px}.pause-title{margin:0 0 6px;font-size:17px;font-weight:600;color:#e2daeF}.privacy-note{font-size:10px;color:#736c80;margin:7px 0 0}.answer-label{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#a997cc;margin-bottom:10px}
@media(max-width:440px){.shell{padding:16px}.top{gap:7px}.brand{font-size:12px}.pill{display:none}.original{font-size:11px}.content{font-size:16px}.hint{max-width:130px;text-align:right}}
`;

/** Anki templates are untrusted HTML. Keep formatting, strip active content, CSS and media. */
export function safeCardContent(html: string): DocumentFragment {
  const fragment = DOMPurify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    ALLOWED_TAGS: [
      'div',
      'span',
      'p',
      'br',
      'b',
      'strong',
      'em',
      'i',
      'u',
      's',
      'sub',
      'sup',
      'blockquote',
      'pre',
      'code',
      'table',
      'thead',
      'tbody',
      'tr',
      'td',
      'th',
      'ul',
      'ol',
      'li',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'hr',
      'ruby',
      'rt',
      'rp',
    ],
    ALLOWED_ATTR: ['colspan', 'rowspan'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    FORBID_TAGS: [
      'script',
      'style',
      'iframe',
      'object',
      'embed',
      'svg',
      'math',
      'img',
      'audio',
      'video',
      'source',
      'link',
      'form',
      'input',
    ],
  }) as DocumentFragment;
  // Anki audio markers do not become network requests or misleading play controls.
  const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode()))
    node.textContent = (node.textContent || '').replace(
      /\[sound:[^\]]+\]/g,
      '[Audio available in Anki]'
    );
  return fragment;
}

function renderContent(target: HTMLElement, html: string): void {
  target.replaceChildren(safeCardContent(html));
  try {
    renderMathInElement(target, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '\\[', right: '\\]', display: true },
        { left: '\\(', right: '\\)', display: false },
        { left: '$', right: '$', display: false },
      ],
      throwOnError: false,
      trust: false,
      strict: 'ignore',
      maxExpand: 1000,
      maxSize: 20,
    });
  } catch {
    // A malformed expression remains readable text, never an unhandled UI failure.
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = ''
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
function button(
  text: string,
  className: string,
  onClick: (event: MouseEvent) => void
): HTMLButtonElement {
  const node = el('button', className, text);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

export interface RecallCardOptions {
  decision: FilterDecision;
  card: ReviewCard | null;
  message?: string;
  demo?: boolean;
  onAnswer(rating: Rating): Promise<RecallResponse>;
  onShowOriginal(): void;
  onSkip(): void;
  onReviewed?(): void;
}

export function createRecallCard(options: RecallCardOptions): HTMLElement {
  const host = el('div');
  host.dataset.foxvoxRecall = 'true';
  host.setAttribute('role', 'region');
  host.setAttribute(
    'aria-label',
    options.demo ? 'FoxVox Recall sample review' : 'FoxVox Recall study card'
  );
  // Keep live Anki contents out of the page's ordinary DOM traversal.
  const shadow = host.attachShadow({ mode: options.demo ? 'open' : 'closed' });
  const sheet = el('style');
  const fontBase =
    typeof chrome !== 'undefined' && chrome.runtime?.getURL
      ? chrome.runtime.getURL('fonts/')
      : './fonts/';
  sheet.textContent =
    style + '\n' + katexStyles.replace(/url\((['"]?)fonts\//g, `url($1${fontBase}`);
  const shell = el('div', 'shell');
  const top = el('div', 'top');
  const mark = el('span', 'mark', 'f');
  mark.setAttribute('aria-hidden', 'true');
  const original = button('Show original', 'original', options.onShowOriginal);
  top.append(
    mark,
    el('span', 'brand', 'FoxVox Recall'),
    el('span', 'pill', options.demo ? 'Sample review' : 'A better detour'),
    original
  );
  const reason = el(
    'p',
    'reason',
    options.decision.explanation || 'Replaced based on your feed preferences.'
  );
  shell.append(top, reason);
  shadow.append(sheet, shell);
  // React handlers higher in the timeline must never receive review interactions.
  for (const event of [
    'click',
    'dblclick',
    'pointerdown',
    'pointerup',
    'keydown',
    'keyup',
    'submit',
  ]) {
    host.addEventListener(event, e => e.stopPropagation());
  }
  const card = options.card;
  if (!card) {
    shell.append(
      el('p', 'pause-title', 'A little breathing room.'),
      el(
        'p',
        'pause',
        options.message || 'No review card is available right now. Open Anki to check your reviews.'
      )
    );
    return host;
  }
  shell.append(
    el('div', 'deck', `${card.isMath ? 'Math practice' : 'Spaced repetition'} · ${card.deckName}`)
  );
  const hasMeaningfulText = (html: string): boolean =>
    !!safeCardContent(html)
      .textContent?.replace(/\[Audio available in Anki\]/g, '')
      .replace(/[\s\u200B-\u200D\uFEFF]/g, '');
  if (!hasMeaningfulText(card.question)) {
    shell.append(
      el('p', 'pause-title', 'This card needs Anki.'),
      el(
        'p',
        'pause',
        'This card uses media or a template that Recall cannot display. Open Anki to review it. No rating has been recorded.'
      )
    );
    const unsupportedFooter = el('div', 'footer');
    unsupportedFooter.append(button('Skip for now', 'muted-button', options.onSkip));
    shell.append(unsupportedFooter);
    return host;
  }
  const content = el('div', 'content');
  renderContent(content, card.question);
  shell.append(content);
  if (card.isMath) {
    const label = el('label', 'scratch-label', 'Try it here');
    const scratch = el('textarea', 'scratch');
    scratch.placeholder = 'Work through the steps…';
    scratch.setAttribute('aria-label', 'Math scratchpad. Not saved.');
    scratch.spellcheck = false;
    label.append(scratch);
    shell.append(
      label,
      el(
        'p',
        'privacy-note',
        options.demo
          ? 'Scratch space stays here. This demo makes no Anki changes.'
          : 'Scratch space stays here. Only your rating goes to Anki.'
      )
    );
  }
  const footer = el('div', 'footer');
  const status = el('p', 'status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  let answered = false;
  let answering = false;
  let revealed = false;
  let skipFooter: HTMLElement | undefined;
  const reveal = button('Reveal answer', 'button', event => {
    if (!options.demo && !event.isTrusted) return;
    if (answered || answering || revealed) return;
    revealed = true;
    if (!hasMeaningfulText(card.answer)) {
      content.replaceChildren(
        el('p', 'pause-title', 'The answer needs Anki.'),
        el(
          'p',
          'pause',
          'This answer uses media or a template that Recall cannot display. Open Anki to review it. No rating has been recorded.'
        )
      );
      footer.replaceChildren(button('Skip for now', 'muted-button', options.onSkip));
      return;
    }
    renderContent(content, card.answer);
    content.prepend(el('div', 'answer-label', 'Answer'));
    footer.remove();
    const grades = el('div', 'grades');
    const names = ['Again', 'Hard', 'Good', 'Easy'];
    names.forEach((name, index) => {
      const rating = (index + 1) as Rating;
      const grade = button(name, `grade${rating === 3 ? ' good' : ''}`, event => {
        if (!options.demo && !event.isTrusted) return;
        if (answering || answered) return;
        answering = true;
        grades.querySelectorAll('button').forEach(node => {
          node.disabled = true;
        });
        original.disabled = true;
        status.classList.remove('error');
        status.textContent = options.demo
          ? 'Recording this sample review…'
          : 'Saving your rating to Anki…';
        options
          .onAnswer(rating)
          .then(response => {
            if (!response.ok)
              throw new Error(
                response.error ||
                  (options.demo
                    ? 'The sample review could not be completed.'
                    : 'Anki could not save this rating.')
              );
            answered = true;
            options.onReviewed?.();
            content.replaceChildren(
              el('p', 'saved', 'A little more learned.'),
              el(
                'p',
                'saved-subtitle',
                options.demo
                  ? 'Sample review complete. No Anki changes.'
                  : 'Your rating is saved in Anki. Back to your day.'
              )
            );
            grades.remove();
            skipFooter?.remove();
            shell.querySelectorAll('.scratch-label, .privacy-note').forEach(node => node.remove());
            status.textContent = options.demo
              ? '✓ Sample review · No Anki changes'
              : '✓ Reviewed in Anki';
            original.disabled = false;
            original.focus({ preventScroll: true });
          })
          .catch((error: unknown) => {
            status.classList.add('error');
            status.textContent =
              error instanceof Error
                ? error.message
                : 'Could not save your rating. The answer is still here.';
            grades.querySelectorAll('button').forEach(node => {
              node.disabled = false;
            });
            original.disabled = false;
          })
          .finally(() => {
            answering = false;
          });
      });
      grade.setAttribute(
        'aria-label',
        options.demo ? `Rate sample ${name}. No Anki changes.` : `Rate ${name} in Anki`
      );
      grades.append(grade);
    });
    shell.insertBefore(grades, status);
    skipFooter = el('div', 'footer');
    skipFooter.append(
      button('Skip for now', 'muted-button', () => {
        if (!answering && !answered) options.onSkip();
      }),
      el('span', 'hint', 'Choose how well you remembered')
    );
    shell.insertBefore(skipFooter, status);
    (grades.children[2] as HTMLButtonElement).focus({ preventScroll: true });
  });
  footer.append(reveal, button('Skip for now', 'muted-button', options.onSkip));
  shell.append(footer, status);
  return host;
}
