export interface SortedVtuPlan extends Record<string, any> {
  zinkiteCategory: string;
  zinkiteCategoryLabel: string;
  zinkiteValidityDays: number | null;
  zinkiteValidityLabel: string;
  zinkiteDataMb: number | null;
}

const ORDER: Record<string, number> = {
  daily: 0, weekly: 1, monthly: 2, long_term: 3, broadband: 4,
  social: 5, night: 6, weekend: 7, campus: 8, streaming: 9,
  special: 10, other: 11,
};

function getValidityDays(name: string): number | null {
  const text = name.toLowerCase();
  const days = [...text.matchAll(/(\d+)\s*[- ]?\s*days?/g)].map((m) => Number(m[1]));
  if (days.length) return Math.max(...days);
  const months = [...text.matchAll(/(\d+)\s*[- ]?\s*months?/g)].map((m) => Number(m[1]) * 30);
  if (months.length) return Math.max(...months);
  if (/\byearly\b|\bannual\b|\b1\s*year\b/.test(text)) return 365;
  if (/\bmonthly\b/.test(text)) return 30;
  if (/\bweekly\b/.test(text)) return 7;
  if (/\bdaily\b/.test(text)) return 1;
  return null;
}

function getDataMb(name: string): number | null {
  const match = name.match(/(\d+(?:\.\d+)?)\s*(TB|GB|MB)\b/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = match[2].toUpperCase();
  return unit === 'TB' ? value * 1_048_576 : unit === 'GB' ? value * 1024 : value;
}

function getCategory(name: string, code: string, days: number | null): [string, string] {
  const text = name.toLowerCase();
  const planCode = code.toLowerCase();
  if (/\bmifi\b|\brouter\b|\bbroadband\b|\bunlimited\b/.test(text)) return ['broadband', 'Broadband & Router'];
  if (/social/.test(planCode) || /^\s*\d+(?:\.\d+)?\s*(?:mb|gb)\s+social\s+plan\b/.test(text)) return ['social', 'Social Plans'];
  if (/night/.test(planCode) || /^\s*\d+(?:\.\d+)?\s*(?:mb|gb)\s+night\s+plan\b/.test(text)) return ['night', 'Night Plans'];
  if (/weekend|sunday/.test(planCode) || /\bweekend\b|\bsunday\b/.test(text)) return ['weekend', 'Weekend Plans'];
  if (/campus/.test(planCode) || /\bcampus\b|camp-boost/.test(text)) return ['campus', 'Campus Plans'];
  if (/(?:^|-)tv-|youtube/.test(planCode) || /\bglo\s*tv\b|\btv\s*(vod|lite|max)\b/.test(text)) return ['streaming', 'Streaming Plans'];
  if (/special|\bdg\b|binge|xtra|always-on/.test(planCode) || /\bspecial\b|best value|\bbinge\b|xtra bundle|always on/.test(text)) return ['special', 'Special Bundles'];
  if (days !== null && days <= 2) return ['daily', 'Daily Plans'];
  if (days !== null && days <= 14) return ['weekly', 'Weekly Plans'];
  if (days !== null && days <= 31) return ['monthly', 'Monthly Plans'];
  if (days !== null && days > 31) return ['long_term', 'Long-term Plans'];
  return ['other', 'Other Plans'];
}

function validityLabel(days: number | null): string {
  if (!days) return 'Validity varies';
  if (days === 1) return '1 day';
  if (days === 365) return '1 year';
  return `${days} days`;
}

export function sortDataPlans(plans: any[]): SortedVtuPlan[] {
  return plans.map((plan, index) => {
    const name = String(plan?.name || 'Data plan').trim();
    const days = getValidityDays(name);
    const [category, label] = getCategory(name, String(plan?.variation_code || ''), days);
    return {
      ...plan,
      zinkiteCategory: category,
      zinkiteCategoryLabel: label,
      zinkiteValidityDays: days,
      zinkiteValidityLabel: validityLabel(days),
      zinkiteDataMb: getDataMb(name),
      __index: index,
    };
  }).sort((a, b) => {
    const category = ORDER[a.zinkiteCategory] - ORDER[b.zinkiteCategory];
    if (category) return category;
    const price = Number(a.variation_amount) - Number(b.variation_amount);
    if (Number.isFinite(price) && price) return price;
    const allowance = (b.zinkiteDataMb || 0) - (a.zinkiteDataMb || 0);
    if (allowance) return allowance;
    return String(a.name).localeCompare(String(b.name), 'en', { numeric: true, sensitivity: 'base' }) || a.__index - b.__index;
  }).map(({ __index, ...plan }) => plan as SortedVtuPlan);
}
