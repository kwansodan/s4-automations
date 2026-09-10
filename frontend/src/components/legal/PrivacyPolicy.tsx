import React from 'react';
import {
  ShieldCheck,
  ArrowLeft,
  Lock,
  FileText,
  Building2,
  CheckCircle2,
  Mail,
  Globe,
  ExternalLink,
} from 'lucide-react';

interface PrivacyPolicyProps {
  onBack: () => void;
}

export const PrivacyPolicy: React.FC<PrivacyPolicyProps> = ({ onBack }) => {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-sky-500 selection:text-white py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Navigation Header */}
        <div className="flex items-center justify-between pb-6 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-600 via-indigo-600 to-purple-600 flex items-center justify-center text-white font-black text-lg shadow-md shadow-indigo-500/20">
              S4
            </div>
            <div>
              <h1 className="text-base font-black text-white tracking-tight">S4 Automations</h1>
              <p className="text-[11px] text-slate-400">Enterprise Bookkeeping &amp; Accounting AI</p>
            </div>
          </div>

          <button
            onClick={onBack}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-sky-400 border border-slate-800 transition cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Return to App</span>
          </button>
        </div>

        {/* Title Header */}
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-950/60 border border-emerald-500/40 text-emerald-400 text-xs font-semibold">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Active &amp; Compliant Privacy Governance</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
            Privacy Policy
          </h2>
          <p className="text-xs text-slate-400">
            Effective Date: September 1, 2026 &bull; Last Revised: September 10, 2026
          </p>
        </div>

        {/* Enterprise Commitment Box */}
        <div className="bg-sky-950/40 border border-sky-500/30 rounded-2xl p-5 space-y-2 text-xs text-sky-200">
          <div className="flex items-center gap-2 font-bold text-sky-300">
            <Lock className="w-4 h-4 text-sky-400" />
            <span>Strict Enterprise Data Confidentiality Commitment</span>
          </div>
          <p className="leading-relaxed">
            S4 Automations operates under strict tenant-segregated principles. We do not sell, rent, or trade your company or client data. 
            Financial receipts, invoices, and bank statements uploaded to S4 Automations are processed strictly via enterprise zero-data-retention APIs and are <strong>never used to train public AI models</strong>.
          </p>
        </div>

        {/* Content Sections */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-8 text-xs text-slate-300 leading-relaxed shadow-xl backdrop-blur-md">
          {/* Section 1 */}
          <section className="space-y-3">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span className="text-sky-400">1.</span> Overview &amp; Operator Identification
            </h3>
            <p>
              This Privacy Policy explains how <strong>S4 Automations Inc.</strong>, operated by <strong>Service4GH</strong> (&ldquo;S4 Automations&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;), collects, utilizes, safeguards, and shares information when you utilize our automated bookkeeping, receipt OCR, bank reconciliation, and accounting ERP synchronization software.
            </p>
            <p>
              By accessing or using S4 Automations, you consent to the data collection and governance practices described in this document.
            </p>
          </section>

          {/* Section 2 */}
          <section className="space-y-3">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span className="text-sky-400">2.</span> Information We Collect
            </h3>
            <div className="space-y-3 pl-2 border-l-2 border-slate-800">
              <div>
                <h4 className="font-bold text-white text-xs">A. Account &amp; Identity Data</h4>
                <p className="text-slate-400 mt-1">
                  Full name, work email address, telephone/WhatsApp contact details, firm or company name, and role credentials.
                </p>
              </div>

              <div>
                <h4 className="font-bold text-white text-xs">B. Financial Documents &amp; Ingestion Data</h4>
                <p className="text-slate-400 mt-1">
                  Receipt photos, supplier bills, delivery chits, handwritten dockets, purchase orders, and PDF/CSV bank and mobile money (MTN MoMo, Telecel Cash) transaction statements provided via Google Drive, email, or direct upload.
                </p>
              </div>

              <div>
                <h4 className="font-bold text-white text-xs">C. Third-Party OAuth Credentials</h4>
                <p className="text-slate-400 mt-1">
                  When you connect integrations, we store authorized OAuth 2.0 tokens strictly for their designated functions:
                </p>
                <ul className="list-disc pl-5 mt-1 space-y-1 text-slate-400">
                  <li><strong>Google Drive &amp; Sheets:</strong> Scoped exclusively to user-designated dropboxes and review spreadsheets.</li>
                  <li><strong>Zoho Books &amp; QuickBooks Online:</strong> Read/write tokens strictly for synchronizing chart of accounts, vendor bills, and bank feeds.</li>
                  <li><strong>LinkedIn API:</strong> OAuth tokens with <code>w_organization_social</code> / <code>w_member_social</code> scopes used strictly when you trigger a release announcement broadcast. We never read or harvest personal messages or feeds.</li>
                </ul>
              </div>
            </div>
          </section>

          {/* Section 3 */}
          <section className="space-y-3">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span className="text-sky-400">3.</span> How We Use Your Information
            </h3>
            <ul className="list-disc pl-5 space-y-1 text-slate-300">
              <li><strong>OCR &amp; Tax Extraction:</strong> Converting messy receipt photos into structured double-entry accounting records (VAT, NHIL, GETFund, COVID levy).</li>
              <li><strong>Staged Review Workflows:</strong> Writing parsed entries to private Google Sheets for team verification prior to ERP posting.</li>
              <li><strong>Client Clarification:</strong> Sending automated WhatsApp messages or secure magic links to clients for transaction explanations.</li>
              <li><strong>Release Announcements:</strong> Publishing feature release notes to LinkedIn, X (Twitter), or client emails when initiated by an administrator.</li>
            </ul>
          </section>

          {/* Section 4 */}
          <section className="space-y-3">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span className="text-sky-400">4.</span> Third-Party Sub-processors
            </h3>
            <p>
              We partner only with vetted enterprise cloud providers:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                <span className="font-bold text-white block mb-0.5">Google Cloud &amp; Vertex AI</span>
                <span className="text-[11px] text-slate-400">OCR &amp; document parsing. No customer data is retained for model training.</span>
              </div>
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                <span className="font-bold text-white block mb-0.5">Mailjet</span>
                <span className="text-[11px] text-slate-400">Transactional and release note email dispatch.</span>
              </div>
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                <span className="font-bold text-white block mb-0.5">Twilio</span>
                <span className="text-[11px] text-slate-400">Encrypted WhatsApp notification gateway for transaction queries.</span>
              </div>
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                <span className="font-bold text-white block mb-0.5">Vercel &amp; Cloud Containers</span>
                <span className="text-[11px] text-slate-400">Encrypted application hosting and TLS 1.3 edge delivery.</span>
              </div>
            </div>
          </section>

          {/* Section 5 */}
          <section className="space-y-3">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span className="text-sky-400">5.</span> Security &amp; Data Protection Compliance
            </h3>
            <p>
              We comply with the <strong>Ghana Data Protection Act, 2012 (Act 843)</strong>, the EU <strong>General Data Protection Regulation (GDPR)</strong>, and international security standards.
            </p>
            <p>
              All communication is encrypted using <strong>TLS 1.3</strong> in transit and <strong>AES-256</strong> at rest. Each organization&apos;s data is strictly partitioned by client ID.
            </p>
          </section>

          {/* Section 6 */}
          <section className="space-y-3">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span className="text-sky-400">6.</span> Your Data Rights
            </h3>
            <p>
              You maintain full ownership of your data. You may request export, rectification, or complete deletion of all records and credentials associated with your organization by emailing our privacy desk.
            </p>
          </section>

          {/* Section 7 */}
          <section className="space-y-3 pt-4 border-t border-slate-800">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span className="text-sky-400">7.</span> Contact Us
            </h3>
            <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800 space-y-1.5 text-xs">
              <p className="font-bold text-white">S4 Automations Inc. / Service4GH</p>
              <p className="text-slate-400 flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-sky-400" />
                <span>Privacy Inquiries: <a href="mailto:privacy@service4gh.com" className="text-sky-400 hover:underline">privacy@service4gh.com</a></span>
              </p>
              <p className="text-slate-400 flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-sky-400" />
                <span>Support: <a href="mailto:s4bookkeeping@service4gh.com" className="text-sky-400 hover:underline">s4bookkeeping@service4gh.com</a></span>
              </p>
              <p className="text-slate-400 flex items-center gap-2">
                <Globe className="w-3.5 h-3.5 text-sky-400" />
                <span>Website: <a href="https://s4-automations.com" target="_blank" rel="noreferrer" className="text-sky-400 hover:underline">https://s4-automations.com</a></span>
              </p>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="pt-4 text-center text-xs text-slate-500">
          <p>&copy; 2026 S4 Automations Inc. All rights reserved. Bank-Grade Security &amp; TLS 1.3 Certified.</p>
        </div>
      </div>
    </div>
  );
};
