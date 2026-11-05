// IATA airport code → city name (English), for destinations served from Doha and other major airports.
// Static reference data so providers that return only codes (e.g. AirLabs free plan) still show readable
// destinations without spending API requests. Unknown codes are shown as the code itself — never guessed.
export const AIRPORT_CITY = {
  // Gulf & Middle East
  DXB: 'Dubai', DWC: 'Dubai', AUH: 'Abu Dhabi', SHJ: 'Sharjah', RKT: 'Ras Al Khaimah', MCT: 'Muscat', SLL: 'Salalah', BAH: 'Bahrain',
  KWI: 'Kuwait', RUH: 'Riyadh', JED: 'Jeddah', DMM: 'Dammam', MED: 'Madinah', TIF: 'Taif', AHB: 'Abha', ELQ: 'Qassim', TUU: 'Tabuk',
  YNB: 'Yanbu', GIZ: 'Jazan', HAS: "Ha'il", AMM: 'Amman', AQJ: 'Aqaba', BEY: 'Beirut', BGW: 'Baghdad', BSR: 'Basra', EBL: 'Erbil',
  NJF: 'Najaf', ISU: 'Sulaymaniyah', DAM: 'Damascus', ALP: 'Aleppo', IKA: 'Tehran', THR: 'Tehran', MHD: 'Mashhad', SYZ: 'Shiraz',
  IFN: 'Isfahan', TBZ: 'Tabriz', KIH: 'Kish', ADE: 'Aden', SAH: "Sana'a", TLV: 'Tel Aviv',
  // Africa
  CAI: 'Cairo', HBE: 'Alexandria', SPX: 'Sphinx (Giza)', HRG: 'Hurghada', SSH: 'Sharm El Sheikh', LXR: 'Luxor', CMN: 'Casablanca',
  RAK: 'Marrakech', RBA: 'Rabat', TUN: 'Tunis', ALG: 'Algiers', TIP: 'Tripoli', MJI: 'Tripoli', KRT: 'Khartoum', PZU: 'Port Sudan',
  ADD: 'Addis Ababa', JIB: 'Djibouti', MGQ: 'Mogadishu', HGA: 'Hargeisa', ASM: 'Asmara', NBO: 'Nairobi', MBA: 'Mombasa',
  DAR: 'Dar es Salaam', ZNZ: 'Zanzibar', JRO: 'Kilimanjaro', EBB: 'Entebbe', KGL: 'Kigali', LUN: 'Lusaka', HRE: 'Harare',
  JNB: 'Johannesburg', CPT: 'Cape Town', DUR: 'Durban', MPM: 'Maputo', WDH: 'Windhoek', GBE: 'Gaborone', LAD: 'Luanda',
  LOS: 'Lagos', ABV: 'Abuja', ACC: 'Accra', ABJ: 'Abidjan', DKR: 'Dakar', FIH: 'Kinshasa', SEZ: 'Mahé (Seychelles)',
  MRU: 'Mauritius', TNR: 'Antananarivo', DSS: 'Dakar',
  // South Asia
  DEL: 'New Delhi', BOM: 'Mumbai', BLR: 'Bengaluru', MAA: 'Chennai', HYD: 'Hyderabad', CCU: 'Kolkata', COK: 'Kochi', TRV: 'Thiruvananthapuram',
  CCJ: 'Kozhikode', CNN: 'Kannur', IXE: 'Mangaluru', AMD: 'Ahmedabad', GOI: 'Goa', GOX: 'Goa', ATQ: 'Amritsar', NAG: 'Nagpur', LKO: 'Lucknow',
  JAI: 'Jaipur', PNQ: 'Pune', TRZ: 'Tiruchirappalli', VTZ: 'Visakhapatnam', KHI: 'Karachi', LHE: 'Lahore', ISB: 'Islamabad', PEW: 'Peshawar',
  MUX: 'Multan', SKT: 'Sialkot', UET: 'Quetta', LYP: 'Faisalabad', DAC: 'Dhaka', CGP: 'Chittagong', ZYL: 'Sylhet', CMB: 'Colombo',
  KTM: 'Kathmandu', MLE: 'Malé', KBL: 'Kabul',
  // Asia-Pacific
  BKK: 'Bangkok', DMK: 'Bangkok', HKT: 'Phuket', CNX: 'Chiang Mai', KUL: 'Kuala Lumpur', PEN: 'Penang', SIN: 'Singapore', CGK: 'Jakarta',
  DPS: 'Bali (Denpasar)', SUB: 'Surabaya', MNL: 'Manila', CEB: 'Cebu', CRK: 'Clark', HAN: 'Hanoi', SGN: 'Ho Chi Minh City',
  DAD: 'Da Nang', PNH: 'Phnom Penh', RGN: 'Yangon', HKG: 'Hong Kong', MFM: 'Macau', TPE: 'Taipei', PEK: 'Beijing', PKX: 'Beijing',
  PVG: 'Shanghai', SHA: 'Shanghai', CAN: 'Guangzhou', SZX: 'Shenzhen', CTU: 'Chengdu', TFU: 'Chengdu', CKG: 'Chongqing',
  HGH: 'Hangzhou', XMN: 'Xiamen', NRT: 'Tokyo', HND: 'Tokyo', KIX: 'Osaka', NGO: 'Nagoya', ICN: 'Seoul', GMP: 'Seoul', PUS: 'Busan',
  SYD: 'Sydney', MEL: 'Melbourne', BNE: 'Brisbane', PER: 'Perth', ADL: 'Adelaide', CBR: 'Canberra', AKL: 'Auckland', CHC: 'Christchurch',
  ALA: 'Almaty', NQZ: 'Astana', TAS: 'Tashkent', SKD: 'Samarkand', GYD: 'Baku', TBS: 'Tbilisi', EVN: 'Yerevan', ASB: 'Ashgabat',
  FRU: 'Bishkek', DYU: 'Dushanbe', ULN: 'Ulaanbaatar',
  // Europe
  LHR: 'London', LGW: 'London', STN: 'London', LCY: 'London', MAN: 'Manchester', BHX: 'Birmingham', EDI: 'Edinburgh', GLA: 'Glasgow',
  DUB: 'Dublin', CDG: 'Paris', ORY: 'Paris', NCE: 'Nice', LYS: 'Lyon', MRS: 'Marseille', FRA: 'Frankfurt', MUC: 'Munich', BER: 'Berlin',
  DUS: 'Düsseldorf', HAM: 'Hamburg', STR: 'Stuttgart', AMS: 'Amsterdam', BRU: 'Brussels', ZRH: 'Zurich', GVA: 'Geneva', VIE: 'Vienna',
  CPH: 'Copenhagen', OSL: 'Oslo', ARN: 'Stockholm', HEL: 'Helsinki', MAD: 'Madrid', BCN: 'Barcelona', AGP: 'Málaga',
  LIS: 'Lisbon', OPO: 'Porto', FCO: 'Rome', MXP: 'Milan', LIN: 'Milan', VCE: 'Venice', NAP: 'Naples', PSA: 'Pisa', ATH: 'Athens',
  SKG: 'Thessaloniki', JMK: 'Mykonos', JTR: 'Santorini', IST: 'Istanbul', SAW: 'Istanbul', ESB: 'Ankara', ADB: 'Izmir', AYT: 'Antalya',
  TZX: 'Trabzon', BJV: 'Bodrum', DLM: 'Dalaman', WAW: 'Warsaw', KRK: 'Kraków', PRG: 'Prague', BUD: 'Budapest', OTP: 'Bucharest',
  SOF: 'Sofia', BEG: 'Belgrade', ZAG: 'Zagreb', SJJ: 'Sarajevo', SKP: 'Skopje', TIA: 'Tirana', LCA: 'Larnaca', PFO: 'Paphos', MLA: 'Malta',
  KBP: 'Kyiv', SVO: 'Moscow', DME: 'Moscow', VKO: 'Moscow', LED: 'St Petersburg', KZN: 'Kazan', RIX: 'Riga', VNO: 'Vilnius', TLL: 'Tallinn',
  // Americas
  JFK: 'New York', EWR: 'New York (Newark)', LGA: 'New York', BOS: 'Boston', IAD: 'Washington', DCA: 'Washington', PHL: 'Philadelphia',
  ORD: 'Chicago', ATL: 'Atlanta', MIA: 'Miami', DFW: 'Dallas', IAH: 'Houston', LAX: 'Los Angeles', SFO: 'San Francisco', SEA: 'Seattle',
  YYZ: 'Toronto', YUL: 'Montreal', YVR: 'Vancouver', MEX: 'Mexico City', CUN: 'Cancún', GRU: 'São Paulo', GIG: 'Rio de Janeiro',
  EZE: 'Buenos Aires', SCL: 'Santiago', BOG: 'Bogotá', LIM: 'Lima',
};

export function cityForIata(code) {
  const c = String(code ?? '').trim().toUpperCase();
  return AIRPORT_CITY[c] ?? null;
}
