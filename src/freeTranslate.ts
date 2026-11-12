// src/freeTranslate.ts
// MyMemory ফ্রি API দিয়ে অনুবাদ। কোনো API key লাগে না।
// সীমা: প্রতি অনুরোধে সর্বোচ্চ ৫০০ অক্ষর, তাই বড় লেখা নিজে থেকে ভাগ করা হয়।

const ENDPOINT = "https://api.mymemory.translated.net/get";

// MyMemory-র জন্য ভাষার কোড ঠিক করা (auto হলে Autodetect)
function normalize(code: string): string {
  if (!code || code === "auto") return "Autodetect";
  return code;
}

// লেখাকে ৪৫০ অক্ষরের টুকরোয় ভাগ করে (লাইন ও বাক্যের সীমানা মেনে)
function splitText(text: string, max = 450): string[] {
  const parts: string[] = [];
  for (const line of text.split("\n")) {
    if (line.length <= max) { parts.push(line); continue; }
    // বড় লাইন বাক্য ধরে ভাঙা (। . ! ? এর পরে)
    let buf = "";
    for (const sentence of line.split(/(?<=[।.!?])\s+/)) {
      if ((buf + " " + sentence).length > max) {
        if (buf) parts.push(buf);
        buf = sentence;
      } else {
        buf = buf ? buf + " " + sentence : sentence;
      }
    }
    if (buf) parts.push(buf);
  }
  return parts;
}

async function translateChunk(q: string, source: string, target: string): Promise<string> {
  if (!q.trim()) return q; // ফাঁকা লাইন যেমন আছে তেমন থাকবে

  // URL হাতে জোড়া না দিয়ে URLSearchParams ব্যবহার করা হয়েছে, তাই আগের ভুল আর হবে না
  const params = new URLSearchParams({
    q,
    langpair: `${normalize(source)}|${target}`,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000); // ১৫ সেকেন্ড টাইমআউট
  try {
    const res = await fetch(`${ENDPOINT}?${params.toString()}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`সার্ভার সমস্যা (${res.status})`);
    const data = await res.json();

    if (data.responseStatus !== 200) {
      throw new Error(String(data.responseDetails || "অনুবাদ করা যায়নি"));
    }
    return String(data.responseData.translatedText);
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error("সময় শেষ। ইন্টারনেট সংযোগ দেখুন।");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function freeTranslate(
  text: string,
  source: string,
  target: string
): Promise<string> {
  const clean = text.replace(/\r\n/g, "\n").trim(); // শেষের অতিরিক্ত নতুন লাইন বাদ
  if (!clean) return "";

  const chunks = splitText(clean);
  const out: string[] = [];
  for (const c of chunks) {
    out.push(await translateChunk(c, source, target)); // একটার পর একটা, যাতে সীমা না ভাঙে
  }
  return out.join("\n");
}
