// Country list with ISD codes — used for phone ISD selectors and the Address country dropdown
export const COUNTRIES = [
  { iso2: 'IN', name: 'India',         isd: '+91' },
  { iso2: 'US', name: 'United States', isd: '+1'  },
  { iso2: 'GB', name: 'United Kingdom',isd: '+44' },
  { iso2: 'AE', name: 'UAE',           isd: '+971' },
  { iso2: 'SA', name: 'Saudi Arabia',  isd: '+966' },
  { iso2: 'QA', name: 'Qatar',         isd: '+974' },
  { iso2: 'KW', name: 'Kuwait',        isd: '+965' },
  { iso2: 'OM', name: 'Oman',          isd: '+968' },
  { iso2: 'BH', name: 'Bahrain',       isd: '+973' },
  { iso2: 'NP', name: 'Nepal',         isd: '+977' },
  { iso2: 'BD', name: 'Bangladesh',    isd: '+880' },
  { iso2: 'LK', name: 'Sri Lanka',     isd: '+94'  },
  { iso2: 'SG', name: 'Singapore',     isd: '+65'  },
  { iso2: 'MY', name: 'Malaysia',      isd: '+60'  },
  { iso2: 'AU', name: 'Australia',     isd: '+61'  },
  { iso2: 'CA', name: 'Canada',        isd: '+1'   },
  { iso2: 'DE', name: 'Germany',       isd: '+49'  },
  { iso2: 'FR', name: 'France',        isd: '+33'  },
  { iso2: 'AF', name: 'Afghanistan',   isd: '+93'  },
  { iso2: 'OTHER', name: 'Other',      isd: '+'    },
];

export function findCountry(iso2) {
  return COUNTRIES.find(c => c.iso2 === iso2) || COUNTRIES[0];
}
