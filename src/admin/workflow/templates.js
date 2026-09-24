// Built-in designer templates for the workflow automation.
// Each template is a serialised config (toConfig shape) so it flows through
// fromConfig and renders exactly like a workflow saved from the designer.
// Every node sits on a uniform 2 in (192 px at 96 dpi) grid — one grid step
// between any two connected nodes — so templates open evenly spaced and never
// overlap.
import { fromConfig } from './schema';

// ── Template keys ─────────────────────────────────────────────────────────────

export const NEW_CONTACT_TEMPLATE_KEY = 'new-contact';
export const NEW_CASE_TEMPLATE_KEY    = 'new-case';

// 2 in ≈ 192 px. One grid step is used between any two connected nodes.
const STEP = 192;
const tplNode = (id, type, actionType, x, y, config) => ({
  id, type, position: { x, y }, data: { actionType, config },
});

// ── "New Contact" onboarding template ─────────────────────────────────────────
// Assigns the contact, welcomes them by email when they have one, otherwise
// opens an enquiry case — then logs them to the "New Contacts" list.
//
//   trigger → assign → email-check
//                        ├─(true)  notify-email → list
//                        └─(false) create-case  → list

const NEW_CONTACT_TEMPLATE_CONFIG = {
  v: 1,
  nodes: [
    tplNode('tpl-trigger',       'trigger',  'contactCreated',    444, 100, {}),
    tplNode('tpl-assign',        'action',   'assign',           60+STEP*2, 100+STEP, { assignedTo: '' }),
    tplNode('tpl-email-check',   'condition', 'condition',        444, 484, { field: 'email', operator: 'notEmpty', value: '' }),
    tplNode('tpl-email',         'action',   'notify',            828, 676, {
      channel: 'Email',
      from: '',
      to: '{{contact.email}}',
      subject: 'Welcome to PSRI Hospitals',
      body: 'Dear {{contact.name}}, thank you for registering with us. Our care team will reach out to you shortly. — PSRI Hospitals',
      url: '', message: '',
    }),
    tplNode('tpl-case',          'action',   'createCase',        60, 676, {
      channel: 'Web', typeOfCall: 'Enquiry', callFor: '', typeOfEnquiry: '',
      priority: '', status: 'Open',
      summary: 'New contact — {{contact.name}} ({{contact.mobile}})',
      specialty: '', doctorName: '',
    }),
    tplNode('tpl-log',           'action',  'sheetRow',        444, 868, {
      tab: 'New Contacts',
      rows: [
        { key: 'Contact Name', value: '{{contact.name}}' },
        { key: 'Mobile',       value: '{{contact.mobile}}' },
        { key: 'Source',       value: '{{contact.source}}' },
      ],
    }),
  ],
  edges: [
    { id: 'tpl-e1', source: 'tpl-trigger',     target: 'tpl-assign',         sourceHandle: null, targetHandle: null },
    { id: 'tpl-e2', source: 'tpl-assign',      target: 'tpl-email-check',    sourceHandle: null, targetHandle: null },
    { id: 'tpl-e4', source: 'tpl-email-check', target: 'tpl-email',          sourceHandle: 'true',  targetHandle: null },
    { id: 'tpl-e5', source: 'tpl-email-check', target: 'tpl-case',           sourceHandle: 'false', targetHandle: null },
    { id: 'tpl-e6', source: 'tpl-email',       target: 'tpl-log',            sourceHandle: null, targetHandle: null },
    { id: 'tpl-e8', source: 'tpl-case',        target: 'tpl-log',            sourceHandle: null, targetHandle: null },
  ],
};

// ── "New Case" onboarding template ────────────────────────────────────────────
// Assigns the contact, emails the patient an appointment confirmation when the
// case has a specialty (otherwise an enquiry acknowledgement), then logs the
// case to the "New Cases" list. A patient with no email is simply skipped.
//
//   trigger → assign → specialty-check
//                        ├─(true)  appointment-email → list
//                        └─(false) enquiry-email     → list

const NEW_CASE_TEMPLATE_CONFIG = {
  v: 1,
  nodes: [
    tplNode('tpl-cas-trigger',    'trigger',  'caseCreated',      444, 100, {}),
    tplNode('tpl-cas-assign',     'action', 'assign',  60+STEP*2, 100+STEP, { assignedTo: '' }),
    tplNode('tpl-cas-specialty',  'condition', 'condition',       444, 484, { field: 'case.specialty', operator: 'notEmpty', value: '' }),
    tplNode('tpl-cas-doctor',     'action',   'notify',           828, 676, {
      channel: 'Email',
      from: '',
      to: '{{contact.email}}',
      subject: 'Your appointment request — PSRI Hospitals',
      body: 'Dear {{contact.name}}, we have registered your appointment request for {{case.specialty}} (case {{case.caseId}}). Our team will call you on {{contact.mobile}} to confirm the date and time. — PSRI Hospitals',
      url: '', message: '',
    }),
    tplNode('tpl-cas-team',       'action',   'notify',           60, 676, {
      channel: 'Email',
      from: '',
      to: '{{contact.email}}',
      subject: 'We have received your enquiry — PSRI Hospitals',
      body: 'Dear {{contact.name}}, thank you for contacting PSRI Hospitals. Your enquiry has been registered as case {{case.caseId}} and our team will get back to you shortly. — PSRI Hospitals',
      url: '', message: '',
    }),
    tplNode('tpl-cas-log',        'action',   'sheetRow',         444, 868, {
      tab: 'New Cases',
      rows: [
        { key: 'Case ID',   value: '{{case.caseId}}' },
        { key: 'Contact',   value: '{{contact.name}}' },
        { key: 'Summary',   value: '{{case.summary}}' },
        { key: 'Specialty', value: '{{case.specialty}}' },
      ],
    }),
  ],
  edges: [
    { id: 'tpl-c1', source: 'tpl-cas-trigger',   target: 'tpl-cas-assign',    sourceHandle: null, targetHandle: null },
    { id: 'tpl-c2', source: 'tpl-cas-assign',    target: 'tpl-cas-specialty', sourceHandle: null, targetHandle: null },
    { id: 'tpl-c4', source: 'tpl-cas-specialty', target: 'tpl-cas-doctor',    sourceHandle: 'true',  targetHandle: null },
    { id: 'tpl-c5', source: 'tpl-cas-specialty', target: 'tpl-cas-team',      sourceHandle: 'false', targetHandle: null },
    { id: 'tpl-c6', source: 'tpl-cas-doctor',    target: 'tpl-cas-log',       sourceHandle: null, targetHandle: null },
    { id: 'tpl-c7', source: 'tpl-cas-team',      target: 'tpl-cas-log',       sourceHandle: null, targetHandle: null },
  ],
};

// ── Builders ─────────────────────────────────────────────────────────────────

export function buildNewContactTemplate(assigneeId) {
  const cfg = JSON.parse(JSON.stringify(NEW_CONTACT_TEMPLATE_CONFIG));
  const a = cfg.nodes.find(n => n.data.actionType === 'assign');
  if (assigneeId && a) a.data.config.assignedTo = String(assigneeId);
  return fromConfig(cfg);
}

export function buildNewCaseTemplate(assigneeId) {
  const cfg = JSON.parse(JSON.stringify(NEW_CASE_TEMPLATE_CONFIG));
  const a = cfg.nodes.find(n => n.data.actionType === 'assign');
  if (assigneeId && a) a.data.config.assignedTo = String(assigneeId);
  return fromConfig(cfg);
}
