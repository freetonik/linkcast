import { Readability } from '@mozilla/readability';
import { Hono } from 'hono';
import { parseHTML } from 'linkedom';
import OpenAI from "openai";
import { Podcast } from 'podcast';

const app = new Hono<{ Bindings: CloudflareBindings }>()

app.get('/', (c) => {
  return c.html(`
    <form method="POST" action="/submit">
      <input type="url" name="url" placeholder="Article URL" required>
      <button type="submit">Convert to Audio</button>
    </form>
    `)
})

app.get('/audio/:filename', async (c) => {
  const filename = c.req.param("filename");
  const file = await c.env.R2_BUCKET_MEDIA.get(filename);
  if (!file) return c.text("File not found", 404);

  return new Response(file.body, { headers: { "Content-Type": "audio/mpeg" } });
});

app.get('/feed', async (c) => {
  const feed = new Podcast({
    title: 'Linkcast Feed',
    description: 'My Super Cool Private Linkcast Feed',
    feedUrl: `${new URL(c.req.url).origin}/feed`,
    siteUrl: `${new URL(c.req.url).origin}/`,
    language: 'en',
    itunesImage: 'https://i.postimg.cc/V6WbNtDd/IMG-0924.jpg'
  });

  const itemsKVValue = await c.env.KV_ITEMS.get('allItems');
  const items = itemsKVValue ? JSON.parse(itemsKVValue) : [];

  for (const item of items) {
    feed.addItem({
      title:  item.title,
      description: `${item.content.substring(0, 200)}...`,
      url: item.url,
      guid: item.url,
			date: new Date(),
      enclosure : {
        url: `${new URL(c.req.url).origin}/audio/${item.filename}`
      },
    });
  }

  return c.text(feed.buildXml(), 200, { "Content-Type": "application/xml" })

});

app.post('/submit', async (c) => {
  const { url } =  (await c.req.parseBody()) as { url: string };
  // TODO: validate url
  const response = await fetch(url);
  const html = await response.text();
  const { document } = parseHTML(html);

  const cleanArticle = new Readability(document).parse();

  // TODO: handle actually not having a response from Readability

  const openai = new OpenAI({"apiKey" : "<OPEN_AI_API_KEY>"});

  const mp3 = await openai.audio.speech.create({
    model: "tts-1",
    voice: "alloy",
    input: cleanArticle.textContent.substring(0, 4096)
  });

  const mp3ArrayBuffer = await mp3.arrayBuffer();
  const filename = `${Date.now()}.mp3`;
  await c.env.R2_BUCKET_MEDIA.put(filename, mp3ArrayBuffer, { httpMetadata: { contentType: "audio/mpeg"} });

  const item = {
    title: cleanArticle?.title,
    content: cleanArticle?.textContent,
    url,
    filename
  }

  const existingItemsKVValue = await c.env.KV_ITEMS.get('allItems');
  const existingArticles = existingItemsKVValue ? JSON.parse(existingItemsKVValue) : [];
  existingArticles.push(item);
  await c.env.KV_ITEMS.put('allItems', JSON.stringify(existingArticles));

  return c.html("<h1>GREAT SUCCESS!</h1>");
});

export default app