import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/LegalPage";
import { CONTACT, OPERATOR_ADDRESS, OPERATOR_LEGAL_NAME } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms and conditions · Courtix",
  description: "The terms for clubs using Courtix, and for members and visitors booking through a club's Courtix pages.",
};

const who = OPERATOR_LEGAL_NAME ?? "Courtix";

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms and conditions"
      intro={
        <p>
          These terms cover <strong>clubs</strong> that use Courtix to run bookings, memberships and messages (part A), and{" "}
          <strong>members and visitors</strong> who book through a club&apos;s Courtix pages (part B). By using Courtix you
          agree to them. How we handle personal data is in our <Link href="/privacy">privacy policy</Link>.
        </p>
      }
    >
      <h2>Who we are</h2>
      <p>
        Courtix (courtix.app) is provided by {who}
        {OPERATOR_ADDRESS ? `, ${OPERATOR_ADDRESS}` : ""}. Contact: <a href={`mailto:${CONTACT.support}`}>{CONTACT.support}</a>.
      </p>

      <h2>Part A: Clubs</h2>

      <h3>1. The service</h3>
      <p>
        Courtix gives your club a booking site on its own address (for example yourclub.courtix.app) and tools to manage
        members, packages, courts, sessions, payments and messages, including Courtix AI Assistant. Features may change as
        Courtix improves; we will tell you about changes that matter to how you work.
      </p>

      <h3>2. Accounts</h3>
      <ul>
        <li>The person who creates the club account is its owner and can add managers and staff. You are responsible for everything done with your club&apos;s accounts.</li>
        <li>Keep sign-in details private, and tell us at once if you think an account has been misused.</li>
      </ul>

      <h3>3. Your data and your members</h3>
      <ul>
        <li>Your club&apos;s data (members, bookings, payments, messages) belongs to your club. You can ask us for a copy at any time, and to delete it when you leave.</li>
        <li>For your members&apos; and visitors&apos; personal data, your club is the data controller under Thailand&apos;s PDPA and {who} is your data processor: we use it only to provide Courtix to you. You are responsible for having a lawful basis for the data you enter, for getting consent before sending news and offers, and for answering your members&apos; requests (we help).</li>
        <li>Prices, packages, session rules and court times you set are your own. Make sure they are correct: Courtix applies them as you set them.</li>
      </ul>

      <h3>4. Payments between your club and its members</h3>
      <ul>
        <li>Members and visitors pay your club, not Courtix: in person, by bank transfer, or by PromptPay to your own account. Courtix records payments; it does not hold or move the money.</li>
        <li>Refunds, disputes and receipts with your members are your club&apos;s responsibility.</li>
        <li>Automatic slip checks confirm a transfer with the Thai bank network and mark it paid only when it clearly matches. Check your bank regularly; you remain responsible for confirming payments you rely on.</li>
      </ul>

      <h3>5. Messaging and the AI assistant</h3>
      <ul>
        <li>If you connect your own LINE (or later WhatsApp) account, you must follow that platform&apos;s rules and keep its keys valid. Messages sent through it are sent on behalf of your club.</li>
        <li>Courtix AI Assistant answers from the information in your club&apos;s Courtix account and books only places that are free or covered by a member&apos;s package. It can make mistakes. Review what it does in Chats, keep your timetable, prices and offers up to date, and step in when needed.</li>
        <li>Send news and offers only to people who agreed to receive them. Automatic follow-ups are sent only to members marked as having agreed, and you choose whether they need your approval first.</li>
      </ul>

      <h3>6. Fair use</h3>
      <p>You agree not to use Courtix to send spam, break the law, harm others, or try to access other clubs&apos; data or interfere with the service.</p>

      <h3>7. Fees</h3>
      <p>
        Fees for Courtix are as agreed with your club in writing or shown on our pricing when you sign up. Third-party costs
        you choose to use (for example your LINE plan&apos;s message allowance) are yours. We will give at least 30 days&apos;
        notice before changing what you pay. Contact: <a href={`mailto:${CONTACT.billing}`}>{CONTACT.billing}</a>.
      </p>

      <h3>8. Availability and support</h3>
      <p>
        We work to keep Courtix running and your data safe, with backups by our database provider, but we cannot promise it
        will always be available or error-free. Support is by email at{" "}
        <a href={`mailto:${CONTACT.support}`}>{CONTACT.support}</a>.
      </p>

      <h3>9. Liability</h3>
      <p>
        To the extent the law allows, {who} is not liable for indirect losses (such as lost income or bookings), or for
        problems caused by third-party services, incorrect information entered by the club, or messages and payments between
        a club and its members. Our total liability to a club for any claim is limited to the fees the club paid for Courtix
        in the 12 months before the claim. Nothing here limits liability that cannot be limited under Thai law.
      </p>

      <h3>10. Ending</h3>
      <p>
        You can stop using Courtix at any time. We may suspend or close an account that breaks these terms or doesn&apos;t
        pay agreed fees, after notice where reasonable. After an account closes, you can ask for a copy of your data within
        30 days; then it is deleted, except where the law requires us to keep it.
      </p>

      <h2>Part B: Members and visitors</h2>
      <ul>
        <li>Your booking is with the club, not with Courtix. The club&apos;s own rules apply: prices, cancellation and refund rules, levels and age limits.</li>
        <li>Pay the club as shown (at the club, or by PromptPay to the club&apos;s account). Questions about payments, refunds or cancellations go to the club.</li>
        <li>Give your real name and a phone number the club can reach you on. Don&apos;t book in someone else&apos;s name or use another member&apos;s sign-in.</li>
        <li>Chat replies may come from Courtix AI Assistant on the club&apos;s behalf. Ask for a person at any time.</li>
        <li>We may limit or block bookings that look like spam or misuse.</li>
      </ul>

      <h2>General</h2>
      <ul>
        <li>These terms are governed by the laws of Thailand, and the courts of Thailand decide any dispute.</li>
        <li>We may update these terms; we will tell clubs about important changes before they take effect. The date at the top shows the latest version.</li>
        <li>If part of these terms can&apos;t be enforced, the rest still applies.</li>
      </ul>
    </LegalPage>
  );
}
