import { Injectable } from '@nestjs/common';

import { Category, TransactionDirection } from '../../../common/domain/constants';
import {
  ClassificationProvider,
  ClassificationRequest,
  ClassificationResult,
} from './classification-provider';

interface Rule {
  id: string;
  /** Lower-cased keywords; any match counts. */
  keywords: string[];
  category: Category;
  confidence: number;
  /** Restricts the rule to one direction when that is what disambiguates it. */
  direction?: TransactionDirection;
  explanation: string;
}

/**
 * Deterministic rules for the Nigerian market.
 *
 * These carry most of the traffic: they are free, instant, reproducible and
 * auditable, which is exactly what a finance team wants for the 80% of
 * transactions that are obviously salary, PAYE, DSTV or a bank charge. The
 * LLM is reserved for what is left over - see HybridClassificationProvider.
 *
 * Ordered most specific first; the first match wins.
 */
const RULES: Rule[] = [
  {
    id: 'bank-charges',
    keywords: [
      'stamp duty',
      'sms alert',
      'account maintenance',
      'commission on turnover',
      'cot charge',
      'nip transfer fee',
      'transfer charge',
      'card maintenance',
      'vat on charge',
      'atm withdrawal fee',
    ],
    category: 'BANKING_FEES',
    confidence: 0.96,
    explanation: 'Matches a standard Nigerian bank charge description',
  },
  {
    id: 'tax',
    keywords: [
      'firs',
      'paye',
      'withholding tax',
      'wht remittance',
      'vat remittance',
      'company income tax',
      'lirs',
      'tax payment',
    ],
    category: 'TAX',
    confidence: 0.95,
    explanation: 'References a Nigerian tax authority or statutory remittance',
  },
  {
    id: 'payroll',
    keywords: ['salary', 'payroll', 'staff wages', 'pension remittance', 'nhf contribution', 'gratuity'],
    category: 'PAYROLL',
    confidence: 0.95,
    direction: 'OUTFLOW',
    explanation: 'Describes a salary, pension or payroll run',
  },
  {
    id: 'rent',
    keywords: ['rent', 'lease payment', 'landlord', 'service charge - office', 'tenancy'],
    category: 'RENT',
    confidence: 0.92,
    direction: 'OUTFLOW',
    explanation: 'Describes rent or a lease payment',
  },
  {
    id: 'utilities-power-and-tv',
    keywords: [
      'ikedc',
      'ekedc',
      'aedc',
      'phcn',
      'eko electricity',
      'ibedc',
      'prepaid token',
      'electricity',
      'dstv',
      'gotv',
      'startimes',
      'water board',
      'lawma',
      'diesel for generator',
    ],
    category: 'UTILITIES',
    confidence: 0.94,
    explanation: 'Matches a Nigerian utility, power or pay-TV provider',
  },
  {
    id: 'utilities-telecom',
    keywords: ['mtn', 'airtel', 'glo ', 'globacom', '9mobile', 'etisalat', 'airtime', 'vtu', 'data bundle', 'spectranet', 'smile broadband'],
    category: 'UTILITIES',
    confidence: 0.9,
    explanation: 'Matches a Nigerian telecom operator or airtime/data purchase',
  },
  {
    id: 'software',
    keywords: [
      'aws',
      'amazon web services',
      'google cloud',
      'google workspace',
      'microsoft 365',
      'azure',
      'github',
      'slack',
      'zoom',
      'figma',
      'adobe',
      'atlassian',
      'notion',
      'hubspot',
      'sentry',
      'digitalocean',
      'subscription renewal',
      'saas',
    ],
    category: 'SOFTWARE',
    confidence: 0.93,
    direction: 'OUTFLOW',
    explanation: 'Matches a known software or cloud vendor',
  },
  {
    id: 'marketing',
    keywords: [
      'google ads',
      'meta ads',
      'facebook ads',
      'instagram promotion',
      'billboard',
      'influencer',
      'radio advert',
      'marketing campaign',
      'brand activation',
    ],
    category: 'MARKETING',
    confidence: 0.91,
    direction: 'OUTFLOW',
    explanation: 'Matches advertising or marketing spend',
  },
  {
    id: 'travel',
    keywords: [
      'air peace',
      'arik air',
      'ibom air',
      'green africa',
      'flight ticket',
      'hotel',
      'uber trip',
      'bolt trip',
      'travel allowance',
      'visa fee',
    ],
    category: 'TRAVEL',
    confidence: 0.9,
    explanation: 'Matches an airline, hotel or ground transport expense',
  },
  {
    id: 'revenue-settlement',
    keywords: ['paystack settlement', 'flutterwave settlement', 'moniepoint settlement', 'pos settlement', 'merchant payout', 'interswitch settlement'],
    category: 'REVENUE',
    confidence: 0.94,
    direction: 'INFLOW',
    explanation: 'Settlement payout from a payment processor',
  },
  {
    id: 'revenue-invoice',
    keywords: ['invoice payment', 'payment for invoice', 'customer payment', 'sales proceeds', 'order payment'],
    category: 'REVENUE',
    confidence: 0.88,
    direction: 'INFLOW',
    explanation: 'Customer payment against an invoice or order',
  },
  {
    id: 'processor-fees',
    keywords: ['paystack fee', 'flutterwave fee', 'transaction fee', 'gateway fee'],
    category: 'BANKING_FEES',
    confidence: 0.9,
    direction: 'OUTFLOW',
    explanation: 'Payment-processor fee',
  },
  {
    id: 'equipment',
    keywords: [
      'equipment purchase',
      'compressor',
      'generator purchase',
      'machinery',
      'packaging materials',
      'spare parts',
      'laptop',
      'furniture purchase',
      'forklift',
    ],
    category: 'EQUIPMENT',
    confidence: 0.86,
    direction: 'OUTFLOW',
    explanation: 'Purchase of equipment or capital items',
  },
  {
    id: 'transfers',
    keywords: [
      'transfer to own account',
      'internal transfer',
      'sweep to',
      'inter-account transfer',
      'own account',
      'treasury sweep',
    ],
    category: 'TRANSFERS',
    confidence: 0.89,
    explanation: 'Movement between the organisation own accounts',
  },
];

/** Vendors that are genuinely ambiguous: matched, but with low confidence. */
const AMBIGUOUS: Rule[] = [
  {
    id: 'ambiguous-marketplace',
    keywords: ['jumia', 'konga', 'aliexpress', 'temu', 'amazon.com'],
    category: 'OTHER',
    confidence: 0.42,
    explanation: 'Online marketplace purchase - could be equipment, supplies or marketing',
  },
  {
    id: 'ambiguous-professional-services',
    keywords: ['consultant', 'retainer', 'legal fee', 'audit fee', 'advisory', 'professional service'],
    category: 'PROFESSIONAL_SERVICES',
    confidence: 0.58,
    explanation: 'Looks like a professional engagement, but the scope is unclear from the description',
  },
  {
    id: 'ambiguous-bank-transfer',
    keywords: ['gtbank', 'access bank', 'zenith bank', 'uba', 'first bank', 'fidelity bank', 'nip transfer', 'transfer to'],
    category: 'TRANSFERS',
    confidence: 0.55,
    explanation: 'Bank transfer with no further context about its purpose',
  },
];

export const RULES_PROVIDER_NAME = 'rules';
export const RULES_PROVIDER_VERSION = '1.0.0';

@Injectable()
export class RulesClassificationProvider implements ClassificationProvider {
  readonly name = RULES_PROVIDER_NAME;
  readonly version = RULES_PROVIDER_VERSION;

  classify(request: ClassificationRequest): Promise<ClassificationResult> {
    return Promise.resolve(this.classifySync(request));
  }

  /** Synchronous twin: no I/O is involved, which makes it trivial to unit test. */
  classifySync(request: ClassificationRequest): ClassificationResult {
    const haystack = `${request.description} ${request.merchant ?? ''}`.toLowerCase();

    for (const rule of [...RULES, ...AMBIGUOUS]) {
      if (rule.direction && rule.direction !== request.direction) continue;

      const matched = rule.keywords.find((keyword) => haystack.includes(keyword));
      if (!matched) continue;

      return {
        category: rule.category,
        confidence: rule.confidence,
        source: 'RULES',
        provider: this.name,
        providerVersion: this.version,
        reason: `${rule.explanation} (matched "${matched}")`,
        matchedRule: rule.id,
      };
    }

    // Nothing matched. Returning OTHER at low confidence is honest: it says
    // "unclassified", keeps the transaction reviewable, and lets the hybrid
    // strategy decide whether the LLM is worth the money.
    return {
      category: 'OTHER',
      confidence: 0.2,
      source: 'RULES',
      provider: this.name,
      providerVersion: this.version,
      reason: 'No deterministic rule matched this description or merchant',
      matchedRule: 'no-match',
    };
  }
}
