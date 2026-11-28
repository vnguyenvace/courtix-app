import type { Metadata } from "next";
import { CourtixLogo } from "@/components/CourtixLogo";
import Link from "next/link";
import { param, type SearchParams } from "@/components/Banner";
import { ASSISTANT_NAME } from "@/lib/assistant";

// One-page guide for club owners: connect the club's LINE Official Account to Courtix.
// Public (no sign-in), so Courtix can send the link to a club before they join. English and Thai.
// LINE Developers is only in English, so the Thai text keeps LINE's button names in English.

export const metadata: Metadata = {
  title: "Connect LINE to Courtix · Guide",
  description: "Step-by-step guide for club owners: connect your LINE Official Account to Courtix.",
};

type Lang = "en" | "th";

const T = {
  en: {
    title: "Connect your club's LINE to Courtix",
    intro: `When it's connected, messages to your club's LINE Official Account appear in Courtix (Chats). ${ASSISTANT_NAME} answers questions about sessions, prices and courts, and books places that are free or covered by a member's package. Anything else comes to you. Your own replies from Courtix go out on LINE.`,
    need: "You need",
    needs: [
      "The LINE app on your phone (to log in)",
      "Owner or manager access to your club in Courtix",
      "About 10 minutes",
    ],
    steps: "Steps",
    tips: "Good to know",
    trouble: "If something doesn't work",
  },
  th: {
    title: "เชื่อมต่อ LINE ของคลับกับ Courtix",
    intro: `เมื่อเชื่อมต่อแล้ว ข้อความที่ส่งมาหา LINE Official Account ของคลับจะขึ้นใน Courtix (หน้า Chats) ${ASSISTANT_NAME} จะตอบคำถามเรื่องคลาส ราคา และคอร์ท และจองที่ให้ได้ถ้าฟรีหรือรวมอยู่ในแพ็กเกจของสมาชิก เรื่องอื่น ๆ จะส่งต่อให้คุณ และข้อความที่คุณตอบจาก Courtix จะส่งออกทาง LINE`,
    need: "สิ่งที่ต้องมี",
    needs: [
      "แอป LINE ในมือถือ (ใช้สำหรับล็อกอิน)",
      "สิทธิ์เจ้าของ (owner) หรือผู้จัดการ (manager) ของคลับใน Courtix",
      "เวลาประมาณ 10 นาที",
    ],
    steps: "ขั้นตอน",
    tips: "ควรรู้",
    trouble: "ถ้ามีปัญหา",
  },
} as const;

function Steps({ lang }: { lang: Lang }) {
  if (lang === "th") {
    return (
      <ol className="guide-steps">
        <li>
          <h3>สร้าง LINE Official Account</h3>
          <p>
            ข้ามขั้นตอนนี้ถ้าคลับมีบัญชีอยู่แล้ว ไปที่{" "}
            <a href="https://entry.line.biz/" target="_blank" rel="noreferrer">entry.line.biz</a> กด{" "}
            <b>Create a LINE Official Account</b> ล็อกอินด้วย LINE แล้วใส่ชื่อคลับ หมวดหมู่ (Sports) และประเทศ (Thailand)
            ใช้แพ็กเกจฟรีได้
          </p>
        </li>
        <li>
          <h3>เปิดใช้ Messaging API</h3>
          <p>
            ไปที่ <a href="https://manager.line.biz/" target="_blank" rel="noreferrer">manager.line.biz</a> เลือกบัญชีของคลับ
            กด <b>Settings</b> (มุมขวาบน) → <b>Messaging API</b> → <b>Enable Messaging API</b> เมื่อระบบถาม{" "}
            <b>Provider</b> ให้สร้างใหม่โดยใช้ชื่อคลับหรือชื่อธุรกิจของคุณ (ผู้ใช้ LINE อาจเห็นชื่อนี้)
            ช่อง privacy policy และ terms เว้นว่างได้
          </p>
        </li>
        <li>
          <h3>คัดลอกรหัส 2 ตัว</h3>
          <p>
            ไปที่ <a href="https://developers.line.biz/console/" target="_blank" rel="noreferrer">developers.line.biz/console</a>{" "}
            (ล็อกอินด้วย LINE บัญชีเดิม) เลือก provider แล้วเลือก channel ที่มีชื่อคลับ
          </p>
          <ul>
            <li>แท็บ <b>Basic settings</b>: คัดลอก <b>Channel secret</b> (ตัวอักษรและตัวเลข 32 ตัว)</li>
            <li>
              แท็บ <b>Messaging API</b>: เลื่อนลงล่างสุด ที่ <b>Channel access token (long-lived)</b> กด <b>Issue</b>{" "}
              แล้วคัดลอกรหัสยาว
            </li>
          </ul>
        </li>
        <li>
          <h3>วางรหัสใน Courtix</h3>
          <p>
            ล็อกอินเข้า Courtix ของคลับ ไปที่ <b>Settings</b> → <b>Messaging: LINE</b> วางรหัสทั้งสองแล้วกด{" "}
            <b>Connect LINE</b> Courtix จะตรวจสอบกับ LINE แล้วแสดง <b>Webhook URL</b> ให้คัดลอก
          </p>
        </li>
        <li>
          <h3>ใส่ Webhook URL ใน LINE</h3>
          <p>
            กลับไปที่ LINE Developers แท็บ <b>Messaging API</b> → <b>Webhook settings</b> กด <b>Edit</b> วาง URL แล้วกด{" "}
            <b>Update</b> จากนั้นกด <b>Verify</b> (ต้องขึ้นว่า Success) และเปิด <b>Use webhook</b>
          </p>
        </li>
        <li>
          <h3>ปิดข้อความตอบกลับอัตโนมัติของ LINE</h3>
          <p>
            ที่ LINE Official Account Manager → <b>Settings</b> → <b>Response settings</b> ปิด{" "}
            <b>Auto-response messages</b> และเปิด <b>Webhooks</b> เพื่อไม่ให้สมาชิกได้รับคำตอบซ้ำสองครั้ง
            ข้อความต้อนรับ (Greeting message) เปิดไว้ได้
          </p>
        </li>
        <li>
          <h3>ทดสอบ</h3>
          <p>
            สแกน QR code ของบัญชี (อยู่ในหน้า Home ของ LINE Official Account Manager) เพิ่มเพื่อน แล้วส่งข้อความ เช่น
            &quot;พรุ่งนี้มี open play กี่โมง&quot; ควรได้คำตอบภายในไม่กี่วินาที และแชทจะขึ้นในหน้า <b>Chats</b> ของ Courtix
          </p>
        </li>
      </ol>
    );
  }
  return (
    <ol className="guide-steps">
      <li>
        <h3>Create a LINE Official Account</h3>
        <p>
          Skip this if the club already has one. Go to{" "}
          <a href="https://entry.line.biz/" target="_blank" rel="noreferrer">entry.line.biz</a>, choose{" "}
          <b>Create a LINE Official Account</b>, log in with LINE, and enter the club&apos;s name, a category (Sports) and
          the country (Thailand). The free plan is fine.
        </p>
      </li>
      <li>
        <h3>Turn on Messaging API</h3>
        <p>
          Open <a href="https://manager.line.biz/" target="_blank" rel="noreferrer">manager.line.biz</a> and pick the
          club&apos;s account. Click <b>Settings</b> (top right) → <b>Messaging API</b> → <b>Enable Messaging API</b>.
          When it asks for a <b>Provider</b>, create one with your club&apos;s or business&apos;s name (LINE users may see
          it). The privacy policy and terms fields can stay empty.
        </p>
      </li>
      <li>
        <h3>Copy two values</h3>
        <p>
          Go to <a href="https://developers.line.biz/console/" target="_blank" rel="noreferrer">developers.line.biz/console</a>{" "}
          (same LINE login). Click your provider, then the channel with your club&apos;s name.
        </p>
        <ul>
          <li><b>Basic settings</b> tab: copy the <b>Channel secret</b> (32 letters and numbers).</li>
          <li>
            <b>Messaging API</b> tab: at the bottom, under <b>Channel access token (long-lived)</b>, click <b>Issue</b> and
            copy the long token.
          </li>
        </ul>
      </li>
      <li>
        <h3>Paste them into Courtix</h3>
        <p>
          Sign in to your club in Courtix, go to <b>Settings</b> → <b>Messaging: LINE</b>, paste both values and click{" "}
          <b>Connect LINE</b>. Courtix checks them with LINE and then shows a <b>Webhook URL</b>. Copy it.
        </p>
      </li>
      <li>
        <h3>Give LINE the webhook URL</h3>
        <p>
          Back in LINE Developers, <b>Messaging API</b> tab → <b>Webhook settings</b>: click <b>Edit</b>, paste the URL,
          click <b>Update</b>. Then click <b>Verify</b> (it should say Success) and turn on <b>Use webhook</b>.
        </p>
      </li>
      <li>
        <h3>Turn off LINE&apos;s automatic replies</h3>
        <p>
          In LINE Official Account Manager → <b>Settings</b> → <b>Response settings</b>, turn <b>Auto-response
          messages</b> off and <b>Webhooks</b> on, so members get one answer, not two. The greeting message can stay on.
        </p>
      </li>
      <li>
        <h3>Test it</h3>
        <p>
          Scan your account&apos;s QR code (LINE Official Account Manager → Home), add it as a friend and send a message
          like &quot;What time is open play tomorrow?&quot;. The answer should arrive within a few seconds, and the chat
          appears in Courtix under <b>Chats</b>.
        </p>
      </li>
    </ol>
  );
}

function Tips({ lang }: { lang: Lang }) {
  const items =
    lang === "th"
      ? [
          "LINE ไม่แชร์เบอร์โทรศัพท์ แชทใหม่จึงขึ้นเป็น \"Visitor\" ในหน้าแชทให้เลือกสมาชิกครั้งเดียว (Link to member) หลังจากนั้นระบบจะจำได้ และจองโดยใช้แพ็กเกจของสมาชิกได้",
          "คำตอบที่ส่งทันทีหลังจากสมาชิกทักมาไม่มีค่าใช้จ่าย ข้อความที่ส่งทีหลัง (เช่น ข้อความที่พนักงานตอบภายหลัง หรือข้อความติดตามสมาชิก) จะนับเป็นโควตาข้อความรายเดือนของแพ็กเกจ LINE ของคุณ",
          "Channel access token เหมือนรหัสผ่าน อย่าส่งให้ใครทางแชทหรืออีเมล ถ้ารั่วไหล ให้ออก token ใหม่ใน LINE Developers แล้วกด Replace keys ใน Courtix",
          "Courtix เก็บรหัสแบบเข้ารหัส ไม่มีใครดูย้อนหลังได้ รวมถึงตัวคุณเอง",
          "เปิด/ปิดแชท LINE ได้ทุกเมื่อที่ Settings → Messaging",
        ]
      : [
          "LINE doesn't share phone numbers, so a new chat shows as a \"Visitor\". On the chat page, pick the member once (Link to member). After that they're recognised, and can book with their package.",
          "Replies sent right after a member writes are free. Messages sent later (a staff reply some time after, or a follow-up) count toward your LINE plan's monthly message allowance.",
          "The channel access token works like a password. Don't send it by chat or email. If it leaks, issue a new one in LINE Developers and click Replace keys in Courtix.",
          "Courtix stores the keys encrypted. Nobody can read them back, including you.",
          "You can turn LINE chats off and on any time in Settings → Messaging.",
        ];
  return (
    <ul className="guide-list">
      {items.map((t) => <li key={t}>{t}</li>)}
    </ul>
  );
}

function Trouble({ lang }: { lang: Lang }) {
  const rows: [string, string][] =
    lang === "th"
      ? [
          ["Courtix บอกว่า \"LINE rejected the channel access token\"", "คัดลอก token ไม่ครบ หรือ token ถูกยกเลิกแล้ว กด Issue ใหม่ใน LINE Developers แล้ววางอีกครั้ง"],
          ["กด Verify ใน LINE แล้วไม่ขึ้น Success", "ตรวจว่าวาง Webhook URL จาก Courtix ครบทั้งบรรทัด และกด Connect LINE ใน Courtix แล้ว ถ้ายังไม่ได้ ติดต่อ Courtix พร้อมข้อความที่ LINE แสดง"],
          ["สมาชิกได้รับคำตอบสองข้อความ", "ปิด Auto-response messages ใน Response settings (ขั้นตอนที่ 6)"],
          ["ส่งข้อความแล้วไม่มีคำตอบ", "ตรวจว่าเปิด Use webhook (ขั้นตอนที่ 5) และแชท LINE เปิดอยู่ใน Courtix ถ้าพนักงานรับแชทนั้นไว้ (Waiting for staff) ผู้ช่วยจะไม่ตอบจนกว่าจะกด Hand back"],
        ]
      : [
          ["Courtix says \"LINE rejected the channel access token\"", "The token was cut off when copying, or it was revoked. Click Issue again in LINE Developers and paste the new one."],
          ["Verify in LINE doesn't say Success", "Check you pasted the whole Webhook URL from Courtix, and that you clicked Connect LINE in Courtix first. Still failing? Send Courtix the exact message LINE shows."],
          ["Members get two answers", "Turn off Auto-response messages in Response settings (step 6)."],
          ["No answer arrives", "Check Use webhook is on (step 5) and LINE chats are on in Courtix. If staff took the chat over (Waiting for staff), the assistant stays quiet until someone clicks Hand back."],
        ];
  return (
    <dl className="guide-trouble">
      {rows.map(([q, a]) => (
        <div key={q}>
          <dt>{q}</dt>
          <dd>{a}</dd>
        </div>
      ))}
    </dl>
  );
}

export default async function LineGuidePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const lang: Lang = param(sp, "lang") === "th" ? "th" : "en";
  const t = T[lang];
  return (
    <main className="public guide" lang={lang}>
      <nav className="guide-top" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <CourtixLogo height={28} />
        <span className="tabs" style={{ margin: 0 }}>
          <Link href="/guides/line" className={lang === "en" ? "active" : undefined}>English</Link>
          <Link href="/guides/line?lang=th" className={lang === "th" ? "active" : undefined}>ไทย</Link>
        </span>
      </nav>
      <h1>{t.title}</h1>
      <p className="guide-intro">{t.intro}</p>

      <section className="card guide-need">
        <h2>{t.need}</h2>
        <ul className="guide-list">
          {t.needs.map((n) => <li key={n}>{n}</li>)}
        </ul>
      </section>

      <h2>{t.steps}</h2>
      <Steps lang={lang} />

      <h2>{t.tips}</h2>
      <Tips lang={lang} />

      <h2>{t.trouble}</h2>
      <Trouble lang={lang} />

      <p className="muted small public-foot">Courtix · courtix.app</p>
    </main>
  );
}
