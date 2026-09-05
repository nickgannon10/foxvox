import { startRecall } from './content';
import { classifyLocally } from './classifier';
import { DEFAULT_SETTINGS, RecallStats, RecallTransport, ReviewCard } from './types';

const settings = { ...DEFAULT_SETTINGS, minPostGap: 1 };
let reviewed = 0;
let reserved = 0;
let offline = false;
const leases = new Map<string, ReviewCard>();
const samples = [
  {
    question:
      'Without expanding the product, find the coefficient of \\(x^3\\) in \\[(1 + 2x)^5.\\]',
    answer:
      'Use the binomial theorem: choose which 3 of the 5 factors contribute \\(2x\\).\\[\\binom{5}{3}2^3 = 10 \\cdot 8 = \\boxed{80}\\]<p>The other two factors contribute 1.</p>',
    deckName: 'Mathematics · Combinatorics',
    isMath: true,
  },
  {
    question: '<p>What is the difference between recognition and retrieval?</p>',
    answer:
      '<p><strong>Recognition</strong> is identifying something when you see it. <strong>Retrieval</strong> is producing it from memory without the answer in front of you.</p><p>Before revealing an answer, try to say or write it.</p>',
    deckName: 'Learning · Foundations',
    isMath: false,
  },
  {
    question: 'Find the derivative of \\[f(x)=x^2e^x.\\]',
    answer: 'Apply the product rule: \\[f\u2032(x)=2xe^x+x^2e^x=e^x(x^2+2x).\\]',
    deckName: 'Mathematics · Calculus',
    isMath: true,
  },
];
const stats = (): RecallStats => ({ date: 'demo', reviewed, replaced: reserved });
const transport: RecallTransport = async request => {
  switch (request.type) {
    case 'recall:settings':
      return { ok: true, settings };
    case 'recall:classify':
      return { ok: true, decision: classifyLocally(request.post, settings) };
    case 'recall:next': {
      if (offline)
        return {
          ok: false,
          error: 'Anki is offline. Open Anki and connect again. This post is still filtered.',
        };
      if (reviewed + leases.size >= settings.dailyLimit)
        return { ok: true, card: null, message: 'Your 12 sample reviews are enough for today.' };
      const index = reserved++;
      const card: ReviewCard = {
        ...samples[index % samples.length],
        cardId: index + 1,
        leaseId: `demo-${index}`,
      };
      leases.set(card.leaseId, card);
      return { ok: true, card };
    }
    case 'recall:release':
      leases.delete(request.leaseId);
      return { ok: true };
    case 'recall:answer': {
      if (!leases.has(request.leaseId))
        return { ok: false, error: 'This sample card was already reviewed.' };
      leases.delete(request.leaseId);
      reviewed++;
      document.querySelector('#review-count')!.textContent = String(reviewed);
      (document.querySelector('#progress-bar') as HTMLElement).style.width =
        `${(reviewed / 12) * 100}%`;
      document.querySelector('#demo-status')!.textContent =
        'Sample rating recorded in this preview only. No Anki changes.';
      return { ok: true, stats: stats(), message: 'Sample review complete. No Anki changes.' };
    }
    case 'recall:stats':
      return { ok: true, stats: stats() };
    default:
      return { ok: false, error: 'This is a sample feed; use extension settings for live Anki.' };
  }
};

type SamplePost = { name: string; handle: string; text: string; graphic?: boolean; color?: string };
const posts: SamplePost[] = [
  {
    name: 'Maya Chen',
    handle: 'mayamakes',
    text: 'Small reminder: a good explanation lets you predict something you couldn’t predict before.\n\nThat’s my favorite test for whether I actually understand an idea.',
    color: '#31403e',
  },
  {
    name: 'The Daily Take',
    handle: 'dailytake',
    text: 'The election campaign is heating up. Republicans and Democrats trade another round of partisan attacks.',
  },
  {
    name: 'Eli Park',
    handle: 'elipark',
    text: 'There’s a tiny bit of linear algebra hiding in every sunset photograph. Three channels, a million little vectors.',
    graphic: true,
    color: '#433932',
  },
  {
    name: 'Hot Take Factory',
    handle: 'hottakes',
    text: 'Everyone who disagrees is brainwashed. Retweet if you agree.',
  },
  {
    name: 'Jun Lee',
    handle: 'junbuilds',
    text: 'Made the smallest possible version of the thing today. It’s imperfect, it runs, and now I know what to try tomorrow.',
    color: '#2f3449',
  },
  {
    name: 'Campaign Watch',
    handle: 'campaignwatch',
    text: 'Senators launch a new partisan argument ahead of the election.',
  },
  {
    name: 'Sana Rao',
    handle: 'sanareads',
    text: 'A page of notes. A long walk. A question that follows you home.\n\nA pretty good Saturday.',
    color: '#3c3343',
  },
];
let postCounter = 100;
function addPost(post: SamplePost): HTMLElement {
  const article = document.createElement('article');
  article.className = 'tweet';
  article.dataset.testid = 'tweet';
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = post.name[0];
  if (post.color) avatar.style.background = post.color;
  const body = document.createElement('div');
  body.className = 'tweet-body';
  const byline = document.createElement('div');
  byline.className = 'byline';
  byline.dataset.testid = 'User-Name';
  const name = document.createElement('a');
  name.href = `/${post.handle}`;
  const strong = document.createElement('strong');
  strong.textContent = post.name;
  name.append(strong);
  const handle = document.createElement('span');
  handle.className = 'handle';
  handle.textContent = `@${post.handle}`;
  const stamp = document.createElement('a');
  stamp.href = `/${post.handle}/status/${++postCounter}`;
  const time = document.createElement('time');
  time.textContent = '· 2h';
  stamp.append(time);
  byline.append(name, handle, stamp);
  const text = document.createElement('div');
  text.className = 'tweet-text';
  text.dataset.testid = 'tweetText';
  text.textContent = post.text;
  body.append(byline, text);
  if (post.graphic) {
    const graphic = document.createElement('div');
    graphic.className = 'tweet-graphic';
    graphic.innerHTML = '<span>r · g · b</span><small>THE WORLD,<br>IN THREE DIMENSIONS.</small>';
    body.append(graphic);
  }
  const actions = document.createElement('div');
  actions.className = 'tweet-actions';
  actions.setAttribute('aria-hidden', 'true');
  actions.innerHTML = '<span>♡ 128</span><span>↻ 24</span><span>↗ 12.4k</span><span>⌑</span>';
  body.append(actions);
  article.append(avatar, body);
  document.querySelector('#feed')!.append(article);
  return article;
}
posts.forEach(addPost);
startRecall(transport);
document.querySelector('#reset-demo')!.addEventListener('click', () => window.location.reload());
document.querySelector('#toggle-offline')!.addEventListener('click', event => {
  offline = !offline;
  (event.target as HTMLElement).textContent = offline
    ? 'Reconnect sample Anki'
    : 'Simulate Anki offline';
  document.querySelector('#demo-status')!.textContent = offline
    ? 'Offline simulation active. Add another post to see the fallback.'
    : 'Sample Anki is available again. Add a post to keep trying.';
});
document.querySelector('#add-post')!.addEventListener('click', () => {
  addPost({
    name: 'Alex',
    handle: 'alexnotes',
    text: 'One useful idea to keep: try explaining it from memory.',
  });
  addPost(posts[3]).scrollIntoView({ behavior: 'smooth', block: 'center' });
});
// These are fixture profile links, not destinations to navigate to.
document.querySelector('#feed')!.addEventListener('click', event => {
  if ((event.target as Element).closest('a')) event.preventDefault();
});
