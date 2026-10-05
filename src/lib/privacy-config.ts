/** Public operator facts. Presence validation is not a legal or transfer assessment. */
export type PrivacyEnvironment = Readonly<Record<string, string | undefined>>;

export type PrivacyConfig = {
  operatorName: string | null;
  operatorAddress: string | null;
  operatorCountry: string | null;
  operatorCountryCode: string | null;
  contactEmail: string | null;
  serverCountry: string | null;
  serverCountryCode: string | null;
  transferNotice: string | null;
  taxId: string | null;
  registration: string | null;
  representative: string | null;
  isConfigured: boolean;
  missingFields: string[];
};

// ISO 3166-1 alpha-2 codes. A region such as "EU" is not a server country.
const countryCodes = "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" ");
const validCountryCodes = new Set(countryCodes);

function normalized(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();
}

const countryNames = new Map<string, string>();
for (const language of ["en", "es"]) {
  const names = new Intl.DisplayNames([language], { type: "region", fallback: "none" });
  for (const code of countryCodes) {
    const name = names.of(code);
    if (name) countryNames.set(normalized(name), code);
  }
}

function publicText(value: string | undefined, minimum = 1): string | null {
  const text = value?.trim();
  if (!text || text.length < minimum || text.length > 4000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return null;
  if (/^(?:tbd|todo|pending|pendiente|por confirmar|por completar|changeme|change-me|replace[-_ ]?me|not configured|sin configurar|example|ejemplo|your[-_ ](?:name|company|address|country|email))\b/i.test(text)
    || /\{\{|\}\}|<[^>]+>|\[(?:insert|replace|completar|pendiente)/i.test(text)) return null;
  return text;
}

function country(value: string | undefined) {
  const text = publicText(value, 2);
  if (!text) return null;
  const code = validCountryCodes.has(text.toUpperCase()) ? text.toUpperCase() : countryNames.get(normalized(text));
  return code ? { value: text, code } : null;
}

function email(value: string | undefined) {
  const text = publicText(value, 5);
  if (!text || text.length > 254 || !/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z]{2,63}$/i.test(text)) return null;
  const domain = text.slice(text.lastIndexOf("@") + 1).toLowerCase();
  if (/^(?:example\.(?:com|org|net)|localhost)$/.test(domain) || /\.(?:invalid|example|test)$/.test(domain)) return null;
  return text;
}

/** Accept countries as ISO alpha-2 codes or their English/Spanish country names. */
export function getPrivacyConfig(environment: PrivacyEnvironment = process.env): PrivacyConfig {
  const proposedName = publicText(environment.PRIVACY_OPERATOR_NAME, 3);
  // Tinta identifies the product. It cannot stand in for an unidentified operator.
  const operatorName = proposedName && !/^tinta(?:\s*[·|:—-].*)?$/i.test(proposedName) ? proposedName : null;
  const operatorAddress = publicText(environment.PRIVACY_OPERATOR_ADDRESS, 6);
  const operatorCountry = country(environment.PRIVACY_OPERATOR_COUNTRY);
  const contactEmail = email(environment.PRIVACY_CONTACT_EMAIL);
  const serverCountry = country(environment.PRIVACY_SERVER_COUNTRY);
  const transferNotice = publicText(environment.PRIVACY_TRANSFER_NOTICE, 30);
  const required = {
    PRIVACY_OPERATOR_NAME: operatorName,
    PRIVACY_OPERATOR_ADDRESS: operatorAddress,
    PRIVACY_OPERATOR_COUNTRY: operatorCountry,
    PRIVACY_CONTACT_EMAIL: contactEmail,
    PRIVACY_SERVER_COUNTRY: serverCountry,
    PRIVACY_TRANSFER_NOTICE: transferNotice,
  };
  const missingFields = Object.entries(required).filter(([, value]) => value === null).map(([key]) => key);

  return {
    operatorName,
    operatorAddress,
    operatorCountry: operatorCountry?.value ?? null,
    operatorCountryCode: operatorCountry?.code ?? null,
    contactEmail,
    serverCountry: serverCountry?.value ?? null,
    serverCountryCode: serverCountry?.code ?? null,
    transferNotice,
    taxId: publicText(environment.PRIVACY_TAX_ID),
    registration: publicText(environment.PRIVACY_REGISTRATION),
    representative: publicText(environment.PRIVACY_REPRESENTATIVE),
    isConfigured: missingFields.length === 0,
    missingFields,
  };
}
