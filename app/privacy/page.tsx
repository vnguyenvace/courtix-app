import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import { CONTACT, OPERATOR_ADDRESS, OPERATOR_LEGAL_NAME } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy · Courtix",
  description: "How Courtix handles personal data for racket clubs, their members and visitors.",
};

const who = OPERATOR_LEGAL_NAME ?? "Courtix";

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      intro={
        <p>
          Courtix is booking, membership and messaging software for racket clubs. Clubs use it to run their bookings and
          talk to their members. This page explains what personal data Courtix handles, why, who else is involved, and the
          choices you have, in line with Thailand&apos;s Personal Data Protection Act B.E. 2562 (PDPA).
        </p>
      }
    >
      <h2>1. Who is responsible</h2>
      <p>
        <strong>For members and visitors of a club:</strong> the club you book with (for example the club whose name and
        logo appear on the booking page) decides what data it collects about you and why. Under the PDPA the club is the{" "}
        <em>data controller</em>. {who} runs the software for the club and handles that data only on the club&apos;s
        instructions, as a <em>data processor</em>. For questions about your bookings or membership, contact the club first;
        we will help the club answer you.
      </p>
      <p>
        <strong>For club owners and staff using Courtix:</strong> {who} is the data controller for your account details
        (name, email, role) and, once Courtix charges clubs, billing details.
      </p>
      <p>
        Contact: <a href={`mailto:${CONTACT.privacy}`}>{CONTACT.privacy}</a>
        {OPERATOR_ADDRESS ? ` · ${OPERATOR_ADDRESS}` : ""}
      </p>

      <h2>2. What data Courtix handles</h2>
      <table>
        <thead>
          <tr><th>About</th><th>Data</th><th>Why</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>Club staff</td>
            <td>Name, email, password (stored only as a secure hash by our sign-in provider), role and locations</td>
            <td>To let you sign in and limit what each person can do</td>
          </tr>
          <tr>
            <td>Members</td>
            <td>
              Name, phone or WhatsApp number, email if given, language, skill level, notes the club writes, packages and
              how they are used, bookings, check-ins, payments, messages with the club, and whether they agreed to news and
              offers. If the member uses the club&apos;s LINE account: their LINE user ID and display name.
            </td>
            <td>To run the member&apos;s bookings and package, send the messages described below, and keep the club&apos;s records</td>
          </tr>
          <tr>
            <td>Visitors who book online</td>
            <td>Name, phone number, what was booked, the answers to the consent boxes, and payment status</td>
            <td>To hold the booking, let the club contact you about it, and record payment</td>
          </tr>
          <tr>
            <td>Payments</td>
            <td>
              Amounts, how something was paid, and transfer slip photos you or the club upload. Courtix never receives card
              or bank login details: payments by PromptPay go straight from your bank to the club.
            </td>
            <td>To show what is paid and what is still due, and to check slips (see section 4)</td>
          </tr>
        </tbody>
      </table>
      <p>
        <strong>Legal basis.</strong> Most of this is needed to provide the booking or membership you asked for (contract).
        Club records are kept for the club&apos;s legitimate interests and legal duties (for example accounting). News and
        offers are sent only to people who ticked the box or told the club they agree (consent), and you can withdraw that
        consent at any time.
      </p>

      <h2>3. Messages you may receive</h2>
      <ul>
        <li>
          <strong>About your bookings:</strong> confirmations, reminders the evening before, waitlist places, cancellations,
          and package ending notices. These are part of the service; a club can turn them off, and you can ask the club to
          stop them for you.
        </li>
        <li>
          <strong>News and offers</strong> (for example &quot;we miss you&quot; or renewal offers): only if you agreed, never
          more often than the club&apos;s set gap between messages. Reply or tell the club to stop.
        </li>
        <li><strong>Sign-in codes</strong> when you ask for one, by LINE, text message or email.</li>
      </ul>

      <h2>4. AI assistant and automatic checks</h2>
      <p>
        Clubs can let <strong>Courtix AI Assistant</strong> answer chat messages, suggest replies and draft follow-up
        messages. To do this, the message you sent and the club information needed to answer (timetable, prices, and for
        members their package and bookings) are sent to <strong>Anthropic</strong>, the company behind the Claude AI model.
        Anthropic processes it to produce the answer; under its commercial terms this data is not used to train its models.
        The assistant only books places that are free or covered by your package; anything else goes to a person at the
        club. If you ask, it tells you it is an AI, and a person can take over at any time.
      </p>
      <p>
        If a club uses automatic slip checks, a photo of the transfer slip you upload is sent to <strong>EasySlip</strong>,
        which confirms the transfer with the Thai bank network, so the club can mark your payment as paid.
      </p>

      <h2>5. Who else handles the data</h2>
      <p>Courtix uses these service providers, each only for the purpose shown:</p>
      <table>
        <thead>
          <tr><th>Provider</th><th>What for</th><th>Where</th></tr>
        </thead>
        <tbody>
          <tr><td>Supabase</td><td>Database, sign-in, file storage (logos, slips)</td><td>Singapore</td></tr>
          <tr><td>Vercel</td><td>Hosting the website and app</td><td>Singapore (and its global network for delivery)</td></tr>
          <tr><td>Anthropic</td><td>AI assistant replies and message drafts</td><td>United States</td></tr>
          <tr><td>LINE (LY Corporation)</td><td>Chats and notices through the club&apos;s own LINE Official Account</td><td>Japan, Thailand and other countries</td></tr>
          <tr><td>EasySlip</td><td>Checking transfer slips (if the club uses it)</td><td>Thailand</td></tr>
          <tr><td>Twilio / Resend</td><td>Sign-in codes by text message / email (when enabled)</td><td>United States</td></tr>
        </tbody>
      </table>
      <p>
        Some of these are outside Thailand. Where data leaves Thailand, we rely on the providers&apos; contractual
        safeguards as the PDPA allows. We do not sell personal data, and Courtix has no advertising or tracking tools.
      </p>

      <h2>6. Cookies</h2>
      <p>
        Courtix uses only cookies it needs to work: to keep staff signed in, to remember a member who signed in on the
        booking page (for up to 90 days), and to remember the club and location you chose. There are no advertising or
        analytics cookies.
      </p>

      <h2>7. How long data is kept</h2>
      <ul>
        <li>Member, booking and payment records: for as long as the club uses Courtix, or until the club deletes them, plus any period the law requires for accounting records.</li>
        <li>Sign-in codes: 10 minutes. Member sign-ins on the booking page: up to 90 days.</li>
        <li>When a club stops using Courtix, its data is deleted on request or after a reasonable period, unless the law requires us to keep it.</li>
      </ul>

      <h2>8. Security</h2>
      <p>
        Data is encrypted in transit. Each club can only see its own data, enforced in the database itself. Messaging keys
        that clubs connect (for example a LINE access token) are stored encrypted, sign-in codes and sign-in tokens are stored
        only as one-way hashes, and transfer slips are kept private to the club. No system is perfect: if a breach affecting
        your data happens, we will inform the club and, where the PDPA requires, the authorities and you.
      </p>

      <h2>9. Your rights</h2>
      <p>Under the PDPA you can ask to:</p>
      <ul>
        <li>see the personal data held about you and get a copy;</li>
        <li>correct it, or have it deleted or anonymised where the law allows;</li>
        <li>restrict or object to how it is used, including all news and offers;</li>
        <li>take it to another service in a common format;</li>
        <li>withdraw consent you gave, at any time.</li>
      </ul>
      <p>
        Members and visitors: contact the club, or write to <a href={`mailto:${CONTACT.privacy}`}>{CONTACT.privacy}</a> and
        we will pass it to the club and help. We reply within 30 days. You can also complain to Thailand&apos;s Personal Data
        Protection Committee (PDPC).
      </p>

      <h2>10. Children</h2>
      <p>
        Clubs may run sessions for children. A parent or guardian should book for a child under 20 and give any consent on
        their behalf, as the PDPA requires for minors.
      </p>

      <h2>11. Changes</h2>
      <p>
        We will update this page when Courtix changes how it handles data, and tell clubs about important changes before
        they take effect. The date at the top shows the latest version.
      </p>
    </LegalPage>
  );
}
