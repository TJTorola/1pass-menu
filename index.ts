import {
  ensureFileSync,
} from "https://deno.land/std@0.99.0/fs/mod.ts";
const { env, run, readTextFileSync, writeTextFileSync } = Deno;

// 30m? TODO: check this.
const SESSION_EXPIRE_MS = 1000 * 60 * 30;
const CACHE = `${env.get('HOME')}/.cache/1pass-menu/cache.json`;

const op = async (commands: Array<string>, session?: string) => {
  const process = run({
    cmd: [
      'op',
      ...(session ? ['--session', session] : []),
      ...commands
    ],
    stdout: 'piped',
  });

  const output = await process.output();
  process.close();
  return (new TextDecoder().decode(output)).replace('\n', '');
}

const fzf = async (input: string): Promise<string> => {
  const process = run({
    cmd: ['fzf'],
    stdout: 'piped',
    stdin: 'piped',
  })
  process.stdin.write(new TextEncoder().encode(input));

  const output = await process.output();
  process.close();
  return (new TextDecoder().decode(output)).replace('\n', '');
}

const copy = async (input: string): Promise<void> => {
  const process = run({
    cmd: ['xclip', '-sel', 'clip'],
    stdin: 'piped'
  });
  await process.stdin.write(new TextEncoder().encode(input));
  process.stdin.close();

  await process.status();
  process.close();
}

// There is more than this, but this is what I care about
type Item = {
  uuid: string,
  templateUuid: string,
  overview: {
    ainfo?: string,
    title: string,
  }
}

const listLoginItems = async (session: string): Promise<Array<Item>> => {
  const resp = await op([
    'list',
    'items',
    '--categories', 'Login',
  ], session);
  return JSON.parse(resp);
}

const getItemPassword = async (session: string, uuid: string): Promise<string> => (
  op(['get', 'item', '--fields', 'password', uuid], session)
);

const signIn = (): Promise<string> => op(['signin', 'my', '--raw']);

const getSession = async (): Promise<string> => {
  ensureFileSync(CACHE);

  let session = null;
  try {
    const text = readTextFileSync(CACHE);
    const parsedText = JSON.parse(text);
    if (parsedText.session && parsedText.expiresAt > Date.now()) {
      session = parsedText.session;
    }
  } catch (e) {}

  if (!session) {
    session = await signIn();
    // Can I do better than plain text storage of this session? Do I need to?
    writeTextFileSync(CACHE, JSON.stringify({ session, expiresAt: Date.now() + SESSION_EXPIRE_MS }))
  }

  return session;
}

const itemToName = (item: Item) => `${item.overview.title} : ${item.overview.ainfo}`;

const getLoginItems = async (session: string): Promise<{
  [name: string]: Item;
}> => {
  const items = await listLoginItems(session);
  return items
    .reduce((acc, i) => ({
      ...acc,
      [itemToName(i)]: i
    }), {});
}

(async () => {
  const session = await getSession();
  const loginItems = await getLoginItems(session);
  const fzfInput = Object.keys(loginItems).join('\n');
  const selectedKey = await fzf(fzfInput);
  const selected = loginItems[selectedKey];
  const password = await getItemPassword(session, selected.uuid);
  await copy(password);
})();
