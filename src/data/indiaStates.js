// India State → City cascade (representative cities per state, not exhaustive)
// For non-India countries, City/State fall back to free text in the Contacts form.
export const INDIA_STATES = {
  'Delhi':          ['New Delhi', 'Dwarka', 'Rohini', 'Saket'],
  'Haryana':        ['Gurugram', 'Faridabad', 'Panchkula', 'Ambala'],
  'Uttar Pradesh':  ['Noida', 'Ghaziabad', 'Lucknow', 'Agra', 'Kanpur'],
  'Punjab':         ['Chandigarh', 'Ludhiana', 'Amritsar', 'Jalandhar'],
  'Rajasthan':      ['Jaipur', 'Udaipur', 'Jodhpur', 'Kota'],
  'Maharashtra':    ['Mumbai', 'Pune', 'Nagpur', 'Nashik'],
  'Karnataka':      ['Bengaluru', 'Mysuru', 'Hubli'],
  'West Bengal':    ['Kolkata', 'Howrah', 'Siliguri'],
  'Gujarat':        ['Ahmedabad', 'Surat', 'Vadodara'],
  'Bihar':          ['Patna', 'Gaya', 'Bhagalpur'],
  'Madhya Pradesh': ['Bhopal', 'Indore', 'Jabalpur'],
  'Tamil Nadu':     ['Chennai', 'Coimbatore', 'Madurai'],
  'Telangana':      ['Hyderabad', 'Warangal'],
  'Other':          ['Other'],
};

export const INDIA_STATE_NAMES = Object.keys(INDIA_STATES);
