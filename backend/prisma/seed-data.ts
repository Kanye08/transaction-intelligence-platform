/**
 * Seed content: realistic Nigerian business activity.
 *
 * Kept separate from the seeding mechanics so the data itself is easy to read
 * and extend. Amounts are decimal strings and go through the Money utility,
 * exactly as an API caller's would.
 */

export interface RecurringPattern {
  description: string;
  merchant: string | null;
  amount: string;
  direction: 'INFLOW' | 'OUTFLOW';
  /** Days between occurrences. */
  everyDays: number;
  accountIndex: number;
  /** Multiplies the amount by a small deterministic variation when true. */
  varies?: boolean;
}

export interface OccasionalPattern {
  description: string;
  merchant: string | null;
  amountRange: [string, string];
  direction: 'INFLOW' | 'OUTFLOW';
  accountIndex: number;
  /** Relative likelihood of being picked on any given day. */
  weight: number;
}

export interface OrganisationSeed {
  id: string;
  name: string;
  slug: string;
  users: { id: string; email: string; name: string; role: 'OWNER' | 'MEMBER' }[];
  accounts: { id: string; name: string; bankName: string; accountNumber: string }[];
  recurring: RecurringPattern[];
  occasional: OccasionalPattern[];
}

export const ORGANISATIONS: OrganisationSeed[] = [
  {
    id: 'org_lagos_foods',
    name: 'Lagos Foods Ltd',
    slug: 'lagos-foods',
    users: [
      { id: 'usr_ada', email: 'ada@lagosfoods.ng', name: 'Ada Obi', role: 'OWNER' },
      { id: 'usr_tunde', email: 'tunde@lagosfoods.ng', name: 'Tunde Bakare', role: 'MEMBER' },
    ],
    accounts: [
      { id: 'acc_lf_ops', name: 'Operations Current Account', bankName: 'GTBank', accountNumber: '0123456789' },
      { id: 'acc_lf_collections', name: 'Collections Account', bankName: 'Zenith Bank', accountNumber: '1023456789' },
      { id: 'acc_lf_payroll', name: 'Payroll Account', bankName: 'Access Bank', accountNumber: '0987654321' },
    ],
    recurring: [
      { description: 'Salary payment - March cycle', merchant: 'Payroll run', amount: '4850000.00', direction: 'OUTFLOW', everyDays: 30, accountIndex: 2 },
      { description: 'PAYE remittance to LIRS', merchant: 'LIRS', amount: '612500.00', direction: 'OUTFLOW', everyDays: 30, accountIndex: 2 },
      { description: 'Pension remittance - ARM Pensions', merchant: 'ARM Pensions', amount: '388000.00', direction: 'OUTFLOW', everyDays: 30, accountIndex: 2 },
      { description: 'Office rent - Victoria Island', merchant: 'Prime Properties Ltd', amount: '3600000.00', direction: 'OUTFLOW', everyDays: 90, accountIndex: 0 },
      { description: 'AWS cloud services invoice', merchant: 'Amazon Web Services', amount: '742350.25', direction: 'OUTFLOW', everyDays: 30, accountIndex: 0, varies: true },
      { description: 'Google Workspace subscription renewal', merchant: 'Google', amount: '186400.00', direction: 'OUTFLOW', everyDays: 30, accountIndex: 0 },
      { description: 'DSTV Business subscription', merchant: 'MultiChoice', amount: '42500.00', direction: 'OUTFLOW', everyDays: 30, accountIndex: 0 },
      { description: 'IKEDC prepaid electricity token', merchant: 'IKEDC', amount: '185000.00', direction: 'OUTFLOW', everyDays: 7, accountIndex: 0, varies: true },
      { description: 'MTN VTU airtime for field staff', merchant: 'MTN Nigeria', amount: '75000.00', direction: 'OUTFLOW', everyDays: 14, accountIndex: 0, varies: true },
      { description: 'Account maintenance and SMS alert charge', merchant: 'GTBank', amount: '2150.75', direction: 'OUTFLOW', everyDays: 10, accountIndex: 0 },
      { description: 'Paystack settlement for online orders', merchant: 'Paystack', amount: '2860000.00', direction: 'INFLOW', everyDays: 2, accountIndex: 1, varies: true },
      { description: 'Internal transfer to own account - treasury sweep', merchant: 'Lagos Foods Ltd', amount: '2000000.00', direction: 'OUTFLOW', everyDays: 15, accountIndex: 1 },
    ],
    occasional: [
      { description: 'Invoice payment from Shoprite Nigeria', merchant: 'Shoprite', amountRange: ['450000.00', '3800000.00'], direction: 'INFLOW', accountIndex: 1, weight: 6 },
      { description: 'Invoice payment from Spar Lekki', merchant: 'Spar', amountRange: ['280000.00', '1750000.00'], direction: 'INFLOW', accountIndex: 1, weight: 4 },
      { description: 'POS settlement from Moniepoint', merchant: 'Moniepoint', amountRange: ['95000.00', '890000.50'], direction: 'INFLOW', accountIndex: 1, weight: 5 },
      { description: 'Diesel supply for generator', merchant: 'Total Energies', amountRange: ['180000.00', '720000.00'], direction: 'OUTFLOW', accountIndex: 0, weight: 4 },
      { description: 'Google Ads campaign spend', merchant: 'Google Ads', amountRange: ['150000.00', '950000.00'], direction: 'OUTFLOW', accountIndex: 0, weight: 3 },
      { description: 'Meta Ads campaign - Ramadan promo', merchant: 'Meta Platforms', amountRange: ['120000.00', '680000.00'], direction: 'OUTFLOW', accountIndex: 0, weight: 2 },
      { description: 'Air Peace flight ticket Lagos-Abuja', merchant: 'Air Peace', amountRange: ['145000.00', '320000.00'], direction: 'OUTFLOW', accountIndex: 0, weight: 2 },
      { description: 'Hotel accommodation - Abuja trip', merchant: 'Transcorp Hilton', amountRange: ['180000.00', '540000.00'], direction: 'OUTFLOW', accountIndex: 0, weight: 2 },
      { description: 'Packaging materials purchase', merchant: 'Jumia', amountRange: ['65000.00', '480000.00'], direction: 'OUTFLOW', accountIndex: 0, weight: 4 },
      { description: 'Logistics and dispatch settlement', merchant: 'GIG Logistics', amountRange: ['85000.00', '450000.00'], direction: 'OUTFLOW', accountIndex: 0, weight: 4 },
      { description: 'Consultant retainer - food safety audit', merchant: 'Olu & Partners', amountRange: ['350000.00', '850000.00'], direction: 'OUTFLOW', accountIndex: 0, weight: 2 },
      { description: 'Stamp duty on transfer', merchant: 'GTBank', amountRange: ['50.00', '150.00'], direction: 'OUTFLOW', accountIndex: 0, weight: 5 },
      { description: 'NIP transfer to supplier', merchant: 'Access Bank', amountRange: ['120000.00', '2200000.00'], direction: 'OUTFLOW', accountIndex: 0, weight: 5 },
      { description: 'Equipment purchase - cold room compressor', merchant: 'ColdChain NG', amountRange: ['890000.00', '2400000.00'], direction: 'OUTFLOW', accountIndex: 0, weight: 1 },
    ],
  },
  {
    id: 'org_abuja_logistics',
    name: 'Abuja Logistics Ltd',
    slug: 'abuja-logistics',
    users: [
      { id: 'usr_bola', email: 'bola@abujalogistics.ng', name: 'Bola Ade', role: 'OWNER' },
      { id: 'usr_chidi', email: 'chidi@abujalogistics.ng', name: 'Chidi Nwosu', role: 'MEMBER' },
    ],
    accounts: [
      { id: 'acc_al_main', name: 'Main Current Account', bankName: 'UBA', accountNumber: '2012345678' },
      { id: 'acc_al_fleet', name: 'Fleet Operations Account', bankName: 'First Bank', accountNumber: '3012345678' },
    ],
    recurring: [
      { description: 'Salary payment - drivers and dispatch', merchant: 'Payroll run', amount: '3120000.00', direction: 'OUTFLOW', everyDays: 30, accountIndex: 0 },
      { description: 'PAYE remittance to FIRS', merchant: 'FIRS', amount: '398000.00', direction: 'OUTFLOW', everyDays: 30, accountIndex: 0 },
      { description: 'Warehouse rent - Idu Industrial', merchant: 'Idu Estates', amount: '2100000.00', direction: 'OUTFLOW', everyDays: 90, accountIndex: 0 },
      { description: 'AEDC prepaid electricity token', merchant: 'AEDC', amount: '96000.00', direction: 'OUTFLOW', everyDays: 7, accountIndex: 0, varies: true },
      { description: 'Airtel data bundle for tracking devices', merchant: 'Airtel Nigeria', amount: '58000.00', direction: 'OUTFLOW', everyDays: 14, accountIndex: 1 },
      { description: 'Microsoft 365 Business subscription', merchant: 'Microsoft', amount: '142000.00', direction: 'OUTFLOW', everyDays: 30, accountIndex: 0 },
      { description: 'Flutterwave settlement for deliveries', merchant: 'Flutterwave', amount: '1760000.00', direction: 'INFLOW', everyDays: 3, accountIndex: 0, varies: true },
      { description: 'Commission on turnover charge', merchant: 'UBA', amount: '3250.50', direction: 'OUTFLOW', everyDays: 10, accountIndex: 0 },
    ],
    occasional: [
      { description: 'Invoice payment from Dangote Cement Plc', merchant: 'Dangote Cement', amountRange: ['850000.00', '6400000.00'], direction: 'INFLOW', accountIndex: 0, weight: 6 },
      { description: 'Invoice payment from BUA Foods', merchant: 'BUA Foods', amountRange: ['420000.00', '2900000.00'], direction: 'INFLOW', accountIndex: 0, weight: 4 },
      { description: 'Diesel for truck fleet', merchant: 'NNPC Retail', amountRange: ['450000.00', '1850000.00'], direction: 'OUTFLOW', accountIndex: 1, weight: 7 },
      { description: 'Truck maintenance and repair', merchant: 'Elizade Motors', amountRange: ['180000.00', '1250000.00'], direction: 'OUTFLOW', accountIndex: 1, weight: 4 },
      { description: 'Vehicle insurance premium', merchant: 'AIICO Insurance', amountRange: ['320000.00', '980000.00'], direction: 'OUTFLOW', accountIndex: 0, weight: 1 },
      { description: 'Road haulage levy payment', merchant: 'FRSC', amountRange: ['25000.00', '120000.00'], direction: 'OUTFLOW', accountIndex: 1, weight: 3 },
      { description: 'Spare parts purchase', merchant: 'Jumia', amountRange: ['45000.00', '390000.00'], direction: 'OUTFLOW', accountIndex: 1, weight: 3 },
      { description: 'Billboard advertising - Kubwa expressway', merchant: 'Outdoor Media NG', amountRange: ['280000.00', '750000.00'], direction: 'OUTFLOW', accountIndex: 0, weight: 1 },
      { description: 'Transfer to fleet account', merchant: 'Abuja Logistics Ltd', amountRange: ['500000.00', '2500000.00'], direction: 'OUTFLOW', accountIndex: 0, weight: 3 },
    ],
  },
];
