/* Sault Newcomer Skills Survey 2026 — questionnaire definition.
   Mirrors the official KoboToolbox form, including its branching (skip) logic and
   the NOC cascades:
     • sector → occupation group  (OCCUPATION_GROUPS, dependent dropdown)
     • occupation group → Section D skills  (OCCUPATION_SKILLS, dynamic skill set)
   Both mappings were extracted from the form's XLSForm definition.
*/

const SKILLS = [
  ["critical_thinking", "Critical Thinking", ""],
  ["problem_solving", "Problem Solving", ""],
  ["systems_analysis", "Systems Analysis", ""],
  ["oral_comprehension", "Oral Communication: Oral Comprehension", ""],
  ["oral_expression", "Oral Communication: Oral Expression", ""],
  ["learning_strategies", "Learning and Strategies", ""],
  ["quality_control", "Quality Control Testing", ""],
  ["decision_making", "Decision Making", ""],
  ["writing", "Writing", ""],
];

// ── employment-status options + the groups that drive Section C branching ──
const EMP_SELF = "Self-employed";
const EMP_CASUAL = "Employed casual (less than 10 hours/week)";
const EMP_PART = "Employed part time (10-30 hours/week)";
const EMP_FULL = "Employed full time (30+ hours/week)";
const EMP_UNEMP_NOTLOOK = "Unemployed and not looking for work";
const EMP_UNEMP_LOOK = "Unemployed and looking for work";
const EMP_SOCIAL = "Social assistance";
const EMP_DISABILITY = "Unable to work / on disability";
const EMP_STUDENT = "Student or recent graduate";
const EMP_RETIRED = "Retired";
const EMP_HOMEMAKER = "Homemaker / caregiver";
const EMP_PREFERNOT = "Prefer not to answer";

const EMPLOYMENT_STATUS = [
  EMP_SELF, EMP_CASUAL, EMP_PART, EMP_FULL,
  EMP_UNEMP_NOTLOOK, EMP_UNEMP_LOOK, EMP_SOCIAL, EMP_DISABILITY,
  EMP_STUDENT, EMP_RETIRED, EMP_HOMEMAKER, EMP_PREFERNOT,
];

const WORKING = [EMP_SELF, EMP_CASUAL, EMP_PART, EMP_FULL];
const PART_OR_CASUAL = [EMP_CASUAL, EMP_PART];
const NOT_LOOKING = [EMP_UNEMP_NOTLOOK, EMP_SOCIAL, EMP_DISABILITY, EMP_HOMEMAKER];

const SECTORS = [
  "Legislative and senior management occupations (e.g., Mayor; CEO)",
  "Business, finance and administration occupations (e.g., Accountant; Administrative Assistant)",
  "Natural and applied sciences and related occupations (e.g., Software Developer; Civil Engineer)",
  "Health occupations (e.g., Nurse; Pharmacist)",
  "Education, law, social and government services (e.g., Teacher; Social Worker)",
  "Art, culture, recreation and sport (e.g., Graphic Designer; Photographer)",
  "Sales and service occupations (e.g., Sales Associate; Customer Service Representative)",
  "Trades and transport occupations (e.g., Electrician; Truck Driver)",
  "Natural resources and agriculture (e.g., General Farm Worker; Forestry Labourer)",
  "Manufacturing and utilities (e.g., Production Worker; Warehouse Worker)",
];

// Occupation groups shown for each sector (NOC broad → major groups), matching the Kobo form.
const OCCUPATION_GROUPS = {
  [SECTORS[0]]: ["Legislative and senior managers"],
  [SECTORS[1]]: [
    "Specialized middle management - admin, finance and business",
    "Professional occupations in finance and business",
    "Administrative and financial supervisors and specialists",
    "Administrative and transportation logistics occupations",
    "Administrative support and supply chain logistics",
  ],
  [SECTORS[2]]: [
    "Specialized middle management - engineering and science",
    "Professional occupations in natural and applied sciences",
    "Technical occupations in natural and applied sciences",
  ],
  [SECTORS[3]]: [
    "Specialized middle management in health care",
    "Professional occupations in health",
    "Technical occupations in health",
    "Assisting occupations in support of health services",
  ],
  [SECTORS[4]]: [
    "Managers in public administration and public protection",
    "Professional occupations in law, education and social services",
    "Paraprofessional occupations in legal and social services",
    "Assisting occupations in education and public protection",
    "Care providers and public protection support",
    "Student monitors, crossing guards and related",
  ],
  [SECTORS[5]]: [
    "Specialized middle management in art, culture and sport",
    "Professional occupations in art and culture",
    "Technical occupations in art, culture and sport",
    "Occupations in art, culture and sport",
    "Support occupations in sport",
    "Support occupations in art and culture",
  ],
  [SECTORS[6]]: [
    "Middle management in retail, wholesale and customer services",
    "Retail and service supervisors and specialized sales",
    "Occupations in sales and services",
    "Sales, service and customer services representatives",
    "Sales and service support occupations",
  ],
  [SECTORS[7]]: [
    "Middle management in trades and transportation",
    "Technical trades and transportation officers",
    "General trades",
    "Mail, transport operators and maintenance workers",
    "Helpers, labourers and other transport operators",
  ],
  [SECTORS[8]]: [
    "Middle management in natural resources and agriculture",
    "Supervisors in natural resources and agriculture",
    "Occupations in natural resources and related production",
    "Workers in natural resources and agriculture",
    "Harvesting, landscaping and natural resources labourers",
  ],
  [SECTORS[9]]: [
    "Middle management in manufacturing and utilities",
    "Processing, manufacturing and utilities supervisors",
    "Central control operators and aircraft assemblers",
    "Machine operators, assemblers and inspectors",
    "Labourers in processing, manufacturing and utilities",
  ],
};

const MONTHS_RANGE = [
  "Less than 3 months", "3-6 months", "6-9 months", "9-12 months",
  "More than 1 year", "More than 2 years", "More than 3 years",
];

const RATING_5 = ["Very low", "Low", "Moderate", "High", "Very high"];

// Works for both single-select (string) and multi-select (array) answers.
const includes = (v, opt) => (Array.isArray(v) ? v.includes(opt) : v === opt);

const OCCUPATION_SKILLS = {
  "Legislative and senior managers": ["Coordinating", "Critical Thinking", "Decision Making", "Digital Literacy", "Evaluation", "Instructing", "Learning and Teaching Strategies", "Management of Financial Resources", "Management of Material Resources", "Management of Personnel Resources"],
  "Specialized middle management - admin, finance and business": ["Coordinating", "Critical Thinking", "Decision Making", "Digital Literacy", "Evaluation", "Instructing", "Learning and Teaching Strategies", "Management of Financial Resources", "Management of Material Resources", "Management of Personnel Resources"],
  "Professional occupations in finance and business": ["Critical Thinking", "Decision Making", "Digital Literacy", "Evaluation", "Numeracy", "Oral Communication: Oral Comprehension", "Oral Communication: Oral Expression", "Persuading", "Problem Solving", "Reading Comprehension"],
  "Administrative and financial supervisors and specialists": ["Reading Comprehension", "Writing", "Oral Communication: Oral Comprehension", "Digital Literacy", "Evaluation", "Critical Thinking", "Oral Communication: Oral Expression", "Decision Making", "Persuading", "Systems Analysis"],
  "Administrative and transportation logistics occupations": ["Writing", "Oral Communication: Oral Comprehension", "Reading Comprehension", "Oral Communication: Active Listening", "Coordinating", "Critical Thinking", "Decision Making", "Management of Material Resources", "Negotiating", "Numeracy"],
  "Administrative support and supply chain logistics": ["Oral Communication: Oral Comprehension", "Numeracy", "Social Perceptiveness", "Management of Material Resources", "Oral Communication: Active Listening", "Persuading", "Writing", "Problem Solving", "Oral Communication: Oral Expression", "Reading Comprehension"],
  "Specialized middle management - engineering and science": ["Coordinating", "Critical Thinking", "Decision Making", "Digital Literacy", "Evaluation", "Instructing", "Learning and Teaching Strategies", "Management of Financial Resources", "Management of Material Resources", "Management of Personnel Resources"],
  "Professional occupations in natural and applied sciences": ["Critical Thinking", "Decision Making", "Digital Literacy", "Evaluation", "Instructing", "Learning and Teaching Strategies", "Monitoring", "Numeracy", "Oral Communication: Active Listening", "Oral Communication: Oral Comprehension"],
  "Technical occupations in natural and applied sciences": ["Evaluation", "Critical Thinking", "Problem Solving", "Systems Analysis", "Oral Communication: Oral Comprehension", "Oral Communication: Oral Expression", "Learning and Teaching Strategies", "Quality Control Testing", "Decision Making", "Writing"],
  "Specialized middle management in health care": ["Coordinating", "Critical Thinking", "Decision Making", "Digital Literacy", "Evaluation", "Instructing", "Learning and Teaching Strategies", "Management of Financial Resources", "Management of Material Resources", "Management of Personnel Resources"],
  "Professional occupations in health": ["Critical Thinking", "Decision Making", "Evaluation", "Instructing", "Learning and Teaching Strategies", "Monitoring", "Oral Communication: Active Listening", "Oral Communication: Oral Comprehension", "Oral Communication: Oral Expression", "Problem Solving"],
  "Technical occupations in health": ["Oral Communication: Oral Comprehension", "Social Perceptiveness", "Oral Communication: Active Listening", "Oral Communication: Oral Expression", "Instructing", "Learning and Teaching Strategies", "Monitoring", "Systems Analysis", "Critical Thinking", "Persuading"],
  "Assisting occupations in support of health services": ["Oral Communication: Active Listening", "Social Perceptiveness", "Quality Control Testing", "Operation Monitoring of Machinery and Equipment", "Operation and Control", "Equipment and Tool Selection", "Oral Communication: Oral Comprehension", "Oral Communication: Oral Expression", "Critical Thinking", "Instructing"],
  "Managers in public administration and public protection": ["Coordinating", "Critical Thinking", "Decision Making", "Evaluation", "Instructing", "Learning and Teaching Strategies", "Management of Financial Resources", "Management of Material Resources", "Management of Personnel Resources", "Monitoring"],
  "Professional occupations in law, education and social services": ["Critical Thinking", "Instructing", "Oral Communication: Active Listening", "Oral Communication: Oral Comprehension", "Oral Communication: Oral Expression", "Problem Solving", "Reading Comprehension", "Writing", "Decision Making", "Learning and Teaching Strategies"],
  "Paraprofessional occupations in legal and social services": ["Oral Communication: Active Listening", "Oral Communication: Oral Comprehension", "Social Perceptiveness", "Evaluation", "Oral Communication: Oral Expression", "Problem Solving", "Systems Analysis", "Time Management", "Writing", "Critical Thinking"],
  "Assisting occupations in education and public protection": ["Monitoring", "Evaluation", "Social Perceptiveness", "Writing", "Persuading", "Decision Making", "Instructing", "Critical Thinking", "Learning and Teaching Strategies", "Oral Communication: Oral Expression"],
  "Care providers and public protection support": ["Coordinating", "Critical Thinking", "Decision Making", "Evaluation", "Learning and Teaching Strategies", "Monitoring", "Oral Communication: Active Listening", "Oral Communication: Oral Comprehension", "Oral Communication: Oral Expression", "Persuading"],
  "Student monitors, crossing guards and related": ["Coordinating", "Critical Thinking", "Decision Making", "Instructing", "Learning and Teaching Strategies", "Monitoring", "Negotiating", "Numeracy", "Oral Communication: Active Listening", "Oral Communication: Oral Comprehension"],
  "Specialized middle management in art, culture and sport": ["Coordinating", "Critical Thinking", "Decision Making", "Digital Literacy", "Evaluation", "Instructing", "Learning and Teaching Strategies", "Management of Financial Resources", "Management of Material Resources", "Management of Personnel Resources"],
  "Professional occupations in art and culture": ["Oral Communication: Oral Expression", "Oral Communication: Active Listening", "Reading Comprehension", "Critical Thinking", "Decision Making", "Oral Communication: Oral Comprehension", "Learning and Teaching Strategies", "Persuading", "Social Perceptiveness", "Instructing"],
  "Technical occupations in art, culture and sport": ["Oral Communication: Oral Comprehension", "Critical Thinking", "Problem Solving", "Management of Material Resources", "Social Perceptiveness", "Evaluation", "Reading Comprehension", "Systems Analysis", "Decision Making", "Monitoring"],
  "Occupations in art, culture and sport": ["Learning and Teaching Strategies", "Oral Communication: Oral Comprehension", "Social Perceptiveness", "Oral Communication: Oral Expression", "Product Design", "Instructing", "Monitoring", "Management of Material Resources", "Oral Communication: Active Listening", "Reading Comprehension"],
  "Support occupations in sport": ["Coordinating", "Critical Thinking", "Decision Making", "Digital Literacy", "Equipment and Tool Selection", "Evaluation", "Instructing", "Learning and Teaching Strategies", "Management of Material Resources", "Management of Personnel Resources"],
  "Support occupations in art and culture": ["Social Perceptiveness", "Critical Thinking", "Decision Making", "Evaluation", "Negotiating", "Oral Communication: Oral Expression", "Persuading"],
  "Middle management in retail, wholesale and customer services": ["Coordinating", "Critical Thinking", "Decision Making", "Digital Literacy", "Evaluation", "Instructing", "Learning and Teaching Strategies", "Management of Financial Resources", "Management of Material Resources", "Management of Personnel Resources"],
  "Retail and service supervisors and specialized sales": ["Monitoring", "Social Perceptiveness", "Management of Material Resources", "Management of Personnel Resources", "Negotiating", "Persuading", "Time Management", "Coordinating", "Oral Communication: Oral Expression", "Instructing"],
  "Occupations in sales and services": ["Social Perceptiveness", "Critical Thinking", "Decision Making", "Evaluation", "Instructing", "Negotiating", "Numeracy", "Oral Communication: Active Listening", "Oral Communication: Oral Comprehension", "Oral Communication: Oral Expression"],
  "Sales, service and customer services representatives": ["Social Perceptiveness", "Persuading", "Instructing", "Oral Communication: Active Listening", "Negotiating", "Coordinating", "Decision Making", "Monitoring", "Time Management", "Learning and Teaching Strategies"],
  "Sales and service support occupations": ["Social Perceptiveness", "Operation and Control", "Oral Communication: Active Listening", "Management of Material Resources", "Operation Monitoring of Machinery and Equipment", "Oral Communication: Oral Expression", "Persuading", "Quality Control Testing", "Monitoring", "Negotiating"],
  "Middle management in trades and transportation": ["Coordinating", "Critical Thinking", "Decision Making", "Evaluation", "Instructing", "Learning and Teaching Strategies", "Management of Financial Resources", "Management of Material Resources", "Management of Personnel Resources", "Monitoring"],
  "Technical trades and transportation officers": ["Quality Control Testing", "Operation and Control", "Operation Monitoring of Machinery and Equipment", "Troubleshooting", "Equipment and Tool Selection", "Preventative Maintenance", "Evaluation", "Repairing", "Systems Analysis", "Setting Up"],
  "General trades": ["Operation and Control", "Operation Monitoring of Machinery and Equipment", "Troubleshooting", "Quality Control Testing", "Preventative Maintenance", "Equipment and Tool Selection", "Management of Material Resources", "Repairing", "Setting Up", "Systems Analysis"],
  "Mail, transport operators and maintenance workers": ["Operation and Control", "Operation Monitoring of Machinery and Equipment", "Troubleshooting", "Equipment and Tool Selection", "Monitoring", "Preventative Maintenance", "Quality Control Testing", "Setting Up", "Decision Making", "Evaluation"],
  "Helpers, labourers and other transport operators": ["Operation Monitoring of Machinery and Equipment", "Operation and Control", "Preventative Maintenance", "Quality Control Testing", "Monitoring", "Social Perceptiveness", "Troubleshooting", "Instructing", "Repairing", "Evaluation"],
  "Middle management in natural resources and agriculture": ["Coordinating", "Critical Thinking", "Decision Making", "Evaluation", "Instructing", "Learning and Teaching Strategies", "Management of Financial Resources", "Management of Material Resources", "Management of Personnel Resources", "Monitoring"],
  "Supervisors in natural resources and agriculture": ["Coordinating", "Critical Thinking", "Decision Making", "Equipment and Tool Selection", "Instructing", "Learning and Teaching Strategies", "Management of Financial Resources", "Management of Material Resources", "Management of Personnel Resources", "Monitoring"],
  "Occupations in natural resources and related production": ["Coordinating", "Critical Thinking", "Decision Making", "Equipment and Tool Selection", "Evaluation", "Management of Material Resources", "Monitoring", "Operation Monitoring of Machinery and Equipment", "Operation and Control", "Preventative Maintenance"],
  "Workers in natural resources and agriculture": ["Operation and Control", "Preventative Maintenance", "Quality Control Testing", "Repairing", "Troubleshooting", "Equipment and Tool Selection", "Management of Material Resources", "Operation Monitoring of Machinery and Equipment", "Coordinating", "Monitoring"],
  "Harvesting, landscaping and natural resources labourers": ["Preventative Maintenance", "Management of Material Resources", "Operation Monitoring of Machinery and Equipment", "Operation and Control", "Repairing", "Quality Control Testing", "Equipment and Tool Selection", "Troubleshooting"],
  "Middle management in manufacturing and utilities": ["Coordinating", "Critical Thinking", "Decision Making", "Digital Literacy", "Evaluation", "Instructing", "Learning and Teaching Strategies", "Management of Financial Resources", "Management of Material Resources", "Management of Personnel Resources"],
  "Processing, manufacturing and utilities supervisors": ["Evaluation", "Operation Monitoring of Machinery and Equipment", "Operation and Control", "Oral Communication: Oral Comprehension", "Oral Communication: Oral Expression", "Problem Solving", "Quality Control Testing", "Reading Comprehension", "Instructing", "Monitoring"],
  "Central control operators and aircraft assemblers": ["Coordinating", "Critical Thinking", "Decision Making", "Equipment and Tool Selection", "Evaluation", "Instructing", "Learning and Teaching Strategies", "Monitoring", "Numeracy", "Operation Monitoring of Machinery and Equipment"],
  "Machine operators, assemblers and inspectors": ["Operation Monitoring of Machinery and Equipment", "Operation and Control", "Quality Control Testing", "Troubleshooting", "Preventative Maintenance"],
};

// v5.1 occupation model: the job-title fields are searchable OaSIS/NOC7
// picklists (no sector/group cascade). Each answer holds an
// "OASIS.dd - Occupation" label; oasis7Of() derives the true 7-digit oasis7
// code (e.g. "2123100") from the label prefix, and the 10 skills are looked up
// from noc7_skill_lookup (loaded via noc-data.js), keyed by that oasis7 code.
const NOC_OCCUPATIONS = ((window.NOC_DATA && window.NOC_DATA.OCCUPATIONS) || []).map((o) => o.label);
const NOC7_SKILLS = (window.NOC_DATA && window.NOC_DATA.SKILLS) || {};
const oasis7Of = (label) => String(label || "").split(" - ")[0].replace(/\D/g, "");
// Matches v5.1's D_noc7: INTENDED occupation first (working → unemployed →
// student), then the current job as a fallback.
const activeOasis7 = (a) =>
  oasis7Of(a.intended_job_title || a.unemployed_intended_job || a.planned_intended_job || a.current_job_title || a.student_current_job || "");

// Plain-language definitions for ambiguous option labels (team-reviewed).
// Keyed by the EXACT option text, so a definition written once applies to every
// question where that option appears (e.g., "Limited network", "Lack of local experience").
const OPTION_DEFINITIONS = {
  // Section A — immigration category
  "Family Sponsored": "You immigrated because a family member already in Canada sponsored you.",
  "Economic Immigrant": "You immigrated through a skilled-worker or business program (e.g., Express Entry, Provincial Nominee).",
  "Refugee": "You came to Canada for protection from danger in your home country.",
  // Section A — non-permanent resident category
  "Temporary Foreign Worker": "In Canada on a work permit tied to an employer or an open work permit.",
  "Refugee Claimant": "You have asked Canada for refugee protection and are waiting for a decision.",
  "Protected Person": "Canada has already accepted that you need protection (approved refugee/protected status).",
  "Temporary Resident Permit Holder": "You hold a special permit to stay temporarily when you'd normally not be allowed.",
  // Section C — what helped your job search
  "Employment or settlement agency": "An organization that helps people find work, or helps newcomers settle in Canada.",
  "Recognition of experience": "An employer accepting and valuing the work experience you gained before.",
  "Networking events": "Events where you meet people in your field to build job connections.",
  // Section C — reasons (shared across part-time / unemployment / not-looking)
  "Lack of local experience": "You haven't worked in Canada or this area yet, which employers often ask for.",
  "Lack of Canadian experience": "You haven't worked in Canada or this area yet, which employers often ask for.",
  "Qualifications not recognized": "Your education, license, or experience from another country isn't accepted here.",
  "Credential recognition issue": "Your education, license, or experience from another country isn't accepted here.",
  "Experience not recognized": "Your education, license, or experience from another country isn't accepted here.",
  "Immigration restrictions": "Conditions on your permit or status limit the work or hours you can do.",
  "Immigration status": "Conditions on your permit or status limit the work or hours you can do.",
  "Skills mismatch": "Your skills don't match the jobs available locally.",
  "Limited network": "You don't know many people who can connect you to jobs.",
  // Section E — support / challenges
  "Credential recognition": "Help getting your foreign education or license accepted in Canada.",
  "Job matching": "A service that connects you to suitable job openings.",
  "Training matching": "A service that connects you to suitable training programs.",
};

// Homepage A/B/C recruitment messages (team-provided, research experiment).
// Identical layout, constant headline + button; only this message body varies.
// Shown VERBATIM — do not paraphrase or trim (research integrity). One is chosen
// at random per visitor (sticky), and which one they saw is recorded.
//   HP1 = Control · HP2 = Social-norm nudge · HP3 = Personalized nudge
const HOME_VARIANTS = {
  HP1: {
    body: [
      "This survey collects information about education, employment experiences, skills, and job search experiences among newcomers in Northern Ontario. The survey takes approximately 10 minutes to complete.",
      "By participating in this survey you will have the option to be entered into a draw to win one of the five $100 gift cards to local businesses.",
      "All information will be anonymized, kept confidential and used for research purposes only.",
    ],
  },
  HP2: {
    body: [
      "Many newcomers in Northern Ontario have already shared their experiences through this survey. By participating, you will join other newcomers who are contributing information about education, employment experiences, skills, and job search experiences in the region. The survey takes approximately 10 minutes to complete.",
      "By participating in this survey, you will have the option to be entered into a draw to win one of five $100 gift cards to local businesses.",
      "All information will be anonymized, kept confidential, and used for research purposes only.",
    ],
  },
  HP3: {
    body: [
      "As a newcomer in Northern Ontario, your own education, employment experiences, skills, and job search experiences are unique and important. This survey is designed to better understand experiences like yours and the factors that influence employment opportunities for newcomers in the region. The survey takes approximately 10 minutes to complete.",
      "By participating in this survey, you will have the option to be entered into a draw to win one of five $100 gift cards to local businesses.",
      "All information will be anonymized, kept confidential, and used for research purposes only.",
    ],
  },
};

// ── v5 option lists (verbatim from Newcomer Survey 2026 v.5.xlsx choices) ──
const V5_EDUCATION = ["Primary school", "High school diploma or equivalent", "Apprenticeship", "College certificate", "Diploma", "Advanced Diploma", "Undergraduate degree", "Post-graduate degree (e.g., Master's, PhD, MD)"];
const V5_HIGHEDU = ["College certificate", "Diploma", "Advanced Diploma", "Undergraduate degree", "Post-graduate degree (e.g., Master's, PhD, MD)"];
const V5_INTSTUDENT = ["Apprenticeship", "College certificate", "Diploma", "Advanced Diploma", "Undergraduate degree", "Post-graduate degree (e.g., Master's)"];
const V5_JOBHELP = ["Professional network", "Employment or settlement centre", "Canadian work experience", "Recognition of previous work experience", "Canadian degree or training", "Internship / volunteer experience", "Social media (e.g., LinkedIn)", "Local job boards", "Other"];
const V5_BARRIERS = ["Lack of Canadian work experience", "Limited mentorship and job-matching support", "Credentials not recognized", "Lack of skills for available jobs", "Limited job opportunities in preferred sector", "Language barriers", "Limited professional network", "Limited knowledge of local job market", "Caregiving responsibilities / homemaking responsibilities", "Discrimination of any kind", "Health issues", "Other"];
const V5_SUPPORT = ["Credential recognition support", "Local training or certification", "Language support", "Local job market information", "Resume/interview support", "Skills-to-job matching platform", "Training recommendations", "Networking support", "Mentorship support", "Childcare support", "Other"];
const V5_UNEMP_REASONS = ["Lack of Canadian work experience", "Credentials not recognized", "Language barriers", "Previous work experience not recognized", "Limited job opportunities in preferred sector", "Limited professional network", "Limited knowledge of local job market", "Other"];
const V5_NOTLOOK = ["Doesn’t need employment income", "Caregiving responsibilities", "Not qualified for available jobs", "Limited suitable jobs", "Immigration issues", "Language barriers", "Low wages", "Health reasons", "Other"];
const V5_EMPLOYMENT = ["Self-employed", "Employed casual (less than 10 hours/week)", "Employed part time (10-30 hours/week)", "Employed full time (30+ hours/week)", "Unemployed and not looking for work", "Unemployed and actively looking for work", "Unable to work", "Student or recent graduate", "Retired", "Homemaker / caregiver"];
const V5_COUNTRIES = ["Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Antigua and Barbuda", "Argentina", "Armenia", "Australia", "Austria", "Azerbaijan", "Bahamas", "Bahrain", "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize", "Benin", "Bhutan", "Bolivia", "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei", "Bulgaria", "Burkina Faso", "Burundi", "Cabo Verde", "Cambodia", "Cameroon", "Canada", "Central African Republic", "Chad", "Chile", "China", "Colombia", "Comoros", "Congo (Democratic Republic)", "Congo (Republic)", "Costa Rica", "Croatia", "Cuba", "Cyprus", "Czech Republic (Czechia)", "Denmark", "Djibouti", "Dominica", "Dominican Republic", "Ecuador", "Egypt", "El Salvador", "Equatorial Guinea", "Eritrea", "Estonia", "Eswatini (Swaziland)", "Ethiopia", "Fiji", "Finland", "France", "Gabon", "Gambia", "Georgia", "Germany", "Ghana", "Greece", "Grenada", "Guatemala", "Guinea", "Guinea-Bissau", "Guyana", "Haiti", "Honduras", "Hungary", "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland", "Israel", "Italy", "Ivory Coast (Cote d'Ivoire)", "Jamaica", "Japan", "Jordan", "Kazakhstan", "Kenya", "Kiribati", "Kuwait", "Kyrgyzstan", "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia", "Libya", "Liechtenstein", "Lithuania", "Luxembourg", "Madagascar", "Malawi", "Malaysia", "Maldives", "Mali", "Malta", "Marshall Islands", "Mauritania", "Mauritius", "Mexico", "Micronesia", "Moldova", "Monaco", "Mongolia", "Montenegro", "Morocco", "Mozambique", "Myanmar (Burma)", "Namibia", "Nauru", "Nepal", "Netherlands", "New Zealand", "Nicaragua", "Niger", "Nigeria", "North Korea", "North Macedonia", "Norway", "Oman", "Pakistan", "Palau", "Palestine", "Panama", "Papua New Guinea", "Paraguay", "Peru", "Philippines", "Poland", "Portugal", "Qatar", "Romania", "Russia", "Rwanda", "Saint Kitts and Nevis", "Saint Lucia", "Saint Vincent and the Grenadines", "Samoa", "San Marino", "Sao Tome and Principe", "Saudi Arabia", "Senegal", "Serbia", "Seychelles", "Sierra Leone", "Singapore", "Slovakia", "Slovenia", "Solomon Islands", "Somalia", "South Africa", "South Korea", "South Sudan", "Spain", "Sri Lanka", "Sudan", "Suriname", "Sweden", "Switzerland", "Syria", "Tajikistan", "Tanzania", "Thailand", "Timor-Leste", "Togo", "Tonga", "Trinidad and Tobago", "Tunisia", "Turkey", "Turkmenistan", "Tuvalu", "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom", "United States", "Uruguay", "Uzbekistan", "Vanuatu", "Vatican City", "Venezuela", "Vietnam", "Yemen", "Zambia", "Zimbabwe"];

// v5 employment-status branch groups (Section C)
const V5_WORKING = [V5_EMPLOYMENT[0], V5_EMPLOYMENT[1], V5_EMPLOYMENT[2], V5_EMPLOYMENT[3]]; // self/casual/part/full
const V5_WORKING_EMPLOYEE = [V5_EMPLOYMENT[1], V5_EMPLOYMENT[2], V5_EMPLOYMENT[3]];          // casual/part/full (not self)
const V5_UNEMP_LOOKING = V5_EMPLOYMENT[5];                                                   // actively looking
const V5_NOT_LOOKING = [V5_EMPLOYMENT[4], V5_EMPLOYMENT[6], V5_EMPLOYMENT[8], V5_EMPLOYMENT[9]]; // not-looking/unable/retired/homemaker
const V5_STUDENT = V5_EMPLOYMENT[7];                                                         // student or recent grad
const isImmigrantOrNonPerm = (a) =>
  includes(a.identity_groups, "Immigrant (permanent resident)") ||
  includes(a.identity_groups, "Non-permanent resident (e.g., work permit, study permit, refugee claimant)");
// Working barrier gate: shown once the intended-job match is answered, for all
// working respondents EXCEPT full-timers whose current job is already intended.
const showWorkBarrierGate = (a) =>
  V5_WORKING.includes(a.employment_status) && a.intended_job != null &&
  !(a.employment_status === V5_EMPLOYMENT[3] && a.intended_job === "Yes");
// Support after working barriers shows for employees (casual/part/full), not the self-employed gate.
const showWorkSupport = (a) => a.work_barrier_gate === "Yes" && a.employment_status !== V5_EMPLOYMENT[0];

const QUESTIONS = [
  // ── Consent ──────────────────────────────────────────────────────────
  {
    id: "consent",
    section: "Consent",
    type: "single",
    text: "Please confirm that you are at least 18 years of age and voluntarily agree to participate in this survey.",
    options: ["I agree", "I disagree"],
  },

  // ── Eligibility check ───────────────────────────────────────────────
  {
    id: "eligible",
    section: "Eligibility Check",
    type: "eligibility",
    text: "Did you move to Northern Ontario after September 2021 to live?",
    options: ["Yes", "No"],
  },
  {
    id: "moved_from",
    section: "Eligibility Check",
    type: "single",
    text: "Where have you moved from?",
    options: [
      "Other parts of Ontario",
      "Outside of Ontario but within Canada",
      "Outside of Canada with an immigration status",
      "Outside of Canada with non-immigration status",
    ],
  },
  {
    id: "province",
    section: "Eligibility Check",
    type: "select",
    text: "Please select the province you moved from",
    visible: (a) => a.moved_from === "Outside of Ontario but within Canada",
    options: [
      "Quebec", "British Columbia", "Alberta", "Manitoba", "Saskatchewan",
      "Nova Scotia", "New Brunswick", "Newfoundland and Labrador",
      "Prince Edward Island", "Yukon", "Northwest Territories", "Nunavut",
    ],
  },
  {
    id: "country_moved_from",
    section: "Eligibility Check",
    type: "picklist",
    text: "Please select the country you moved from",
    placeholder: "Type to search countries…",
    visible: (a) =>
      a.moved_from === "Outside of Canada with an immigration status" ||
      a.moved_from === "Outside of Canada with non-immigration status",
    options: V5_COUNTRIES,
  },

  // ── Section A: Demographics ─────────────────────────────────────────
  {
    id: "gender",
    section: "Section A: Demographics",
    type: "single",
    text: "What is your gender?",
    options: ["Woman", "Man", "Non-binary person or other gender"],
  },
  {
    id: "age_group",
    section: "Section A: Demographics",
    type: "select",
    text: "What is your age group?",
    options: ["18-24", "25-34", "35-44", "45-54", "55-64", "65-74", "75-84", "85 or older"],
  },
  {
    id: "identity_groups",
    section: "Section A: Demographics",
    type: "multi",
    text: "Do you identify with any of the following groups? Select all that apply.",
    exclusiveOption: "None of the above (do not select any other options)",
    options: [
      "Indigenous (First Nations, Métis, Inuit/Inuk)",
      "Visible minority (e.g., South Asian, Chinese, Black)",
      "Immigrant (permanent resident)",
      "Non-permanent resident (e.g., work permit, study permit, refugee claimant)",
      "None of the above (do not select any other options)",
    ],
    exclusiveOption: "None of the above (do not select any other options)",
  },
  {
    id: "immigration_category",
    section: "Section A: Demographics",
    type: "single",
    text: "Select immigration category",
    visible: (a) => includes(a.identity_groups, "Immigrant (permanent resident)"),
    options: ["Family Sponsored", "Economic Immigrant", "Refugee"],
  },
  {
    id: "non_permanent_category",
    section: "Section A: Demographics",
    type: "single",
    text: "Select non-permanent resident category",
    visible: (a) => includes(a.identity_groups, "Non-permanent resident (e.g., work permit, study permit, refugee claimant)"),
    options: [
      "Temporary Foreign Worker", "International Student", "Refugee Claimant",
      "Protected Person", "Temporary Resident Permit Holder", "Other",
    ],
  },
  {
    id: "non_permanent_other",
    section: "Section A: Demographics",
    type: "text",
    text: "Please specify",
    visible: (a) => a.non_permanent_category === "Other",
  },

  // ── Section B: Education ────────────────────────────────────────────
  {
    id: "recent_credential",
    section: "Section B: Education",
    type: "select",
    text: "What is the most recent educational credential you have completed?",
    options: [
      "Primary school", "High school diploma or equivalent", "Apprenticeship",
      "College certificate", "Diploma", "Advanced Diploma",
      "Undergraduate degree", "Post-graduate degree (e.g., Master's, PhD, MD)",
    ],
  },
  {
    id: "program_name",
    section: "Section B: Education",
    type: "textarea",
    text: "What is the name of the program you completed for your most recent credential?",
    help: "Example: BA in Psychology, Project Management Certificate",
  },
  {
    id: "program_location",
    section: "Section B: Education",
    type: "single",
    text: "Where did you complete this program?",
    options: ["In Canada", "Outside Canada"],
  },
  {
    id: "highest_education",
    section: "Section B: Education",
    type: "single",
    text: "Is this program your highest level of education?",
    visible: (a) => a.non_permanent_category !== "International Student",
    options: ["Yes", "No"],
  },
  {
    id: "highest_credential",
    section: "Section B: Education",
    type: "select",
    text: "What is your highest level of education?",
    visible: (a) => a.highest_education === "No",
    options: V5_HIGHEDU,
  },
  {
    id: "highest_program_name",
    section: "Section B: Education",
    type: "textarea",
    text: "What is the name of the program you completed for your highest level of education?",
    visible: (a) => a.highest_education === "No",
  },
  {
    id: "current_program",
    section: "Section B: Education",
    type: "select",
    text: "What is your current program of study?",
    visible: (a) => a.non_permanent_category === "International Student",
    options: V5_INTSTUDENT,
  },
  {
    id: "current_program_name",
    section: "Section B: Education",
    type: "text",
    text: "What is the name of your current program?",
    visible: (a) => a.non_permanent_category === "International Student",
  },

  // ── Section C: Employment ───────────────────────────────────────────
  // Intro — asked of everyone before the employment-status branch
  {
    id: "employed_before",
    section: "Section C: Employment",
    type: "single",
    text: "Were you employed in Canada before moving to Sault Ste. Marie?",
    options: ["Yes", "No", "I directly moved to Sault", "I didn't have a work permit"],
  },
  {
    id: "previous_job_title",
    section: "Section C: Employment",
    type: "picklist",
    text: "What was your last occupation before moving to Sault Ste. Marie?",
    placeholder: "Type to search occupations…",
    visible: (a) => a.employed_before === "Yes",
    options: NOC_OCCUPATIONS,
  },
  {
    id: "home_emp_before",
    section: "Section C: Employment",
    type: "single",
    text: "Were you employed in your home country before moving to Canada?",
    visible: (a) => isImmigrantOrNonPerm(a),
    options: ["Yes", "No"],
  },
  {
    id: "home_country_job",
    section: "Section C: Employment",
    type: "picklist",
    text: "What was your last occupation in your home country?",
    placeholder: "Type to search occupations…",
    visible: (a) => isImmigrantOrNonPerm(a) && a.home_emp_before === "Yes",
    options: NOC_OCCUPATIONS,
  },
  {
    id: "employment_status",
    section: "Section C: Employment",
    type: "single",
    text: "Which of the following best describes your current employment status?",
    options: V5_EMPLOYMENT,
  },

  // ── C · WORKING block (self-employed / casual / part / full time) ──
  {
    id: "current_job_title",
    section: "Section C: Employment",
    type: "picklist",
    text: "What is the title of your current job?",
    placeholder: "Type to search occupations…",
    visible: (a) => V5_WORKING.includes(a.employment_status),
    options: NOC_OCCUPATIONS,
  },
  {
    id: "intended_job",
    section: "Section C: Employment",
    type: "single",
    text: "Is your current job the one you intended to do?",
    visible: (a) => V5_WORKING.includes(a.employment_status),
    options: ["Yes", "No"],
  },
  {
    id: "intended_job_title",
    section: "Section C: Employment",
    type: "picklist",
    text: "What is the title of your intended job?",
    placeholder: "Type to search occupations…",
    visible: (a) => V5_WORKING.includes(a.employment_status) && a.intended_job === "No",
    options: NOC_OCCUPATIONS,
  },
  {
    id: "job_search_help",
    section: "Section C: Employment",
    type: "multi",
    text: "What of the following were useful in your job search in Northern Ontario / Sault Ste. Marie? Select all that apply.",
    visible: (a) => V5_WORKING_EMPLOYEE.includes(a.employment_status),
    options: V5_JOBHELP,
  },
  {
    id: "job_search_other",
    section: "Section C: Employment",
    type: "text",
    text: "Please specify",
    visible: (a) => V5_WORKING_EMPLOYEE.includes(a.employment_status) && includes(a.job_search_help, "Other"),
  },
  {
    id: "work_barrier_gate",
    section: "Section C: Employment",
    type: "single",
    text: "Is there a barrier preventing you from working full time or doing your intended job?",
    visible: (a) => showWorkBarrierGate(a),
    options: ["Yes", "No"],
  },
  {
    id: "work_barriers",
    section: "Section C: Employment",
    type: "multi",
    text: "Select all barriers that apply",
    visible: (a) => showWorkBarrierGate(a) && a.work_barrier_gate === "Yes",
    options: V5_BARRIERS,
  },
  {
    id: "work_barriers_other",
    section: "Section C: Employment",
    type: "text",
    text: "Please specify",
    visible: (a) => showWorkBarrierGate(a) && a.work_barrier_gate === "Yes" && includes(a.work_barriers, "Other"),
  },
  {
    id: "work_support",
    section: "Section C: Employment",
    type: "multi",
    text: "Which type of support would help you get the job you want? Select all that apply.",
    visible: (a) => showWorkSupport(a),
    options: V5_SUPPORT,
  },
  {
    id: "work_support_other",
    section: "Section C: Employment",
    type: "text",
    text: "Please specify",
    visible: (a) => showWorkSupport(a) && includes(a.work_support, "Other"),
  },

  // ── C · UNEMPLOYED & actively looking block ──
  {
    id: "unemployed_intended_job",
    section: "Section C: Employment",
    type: "picklist",
    text: "What is the title of your intended job?",
    placeholder: "Type to search occupations…",
    visible: (a) => a.employment_status === V5_UNEMP_LOOKING,
    options: NOC_OCCUPATIONS,
  },
  {
    id: "unemployed_barrier_gate",
    section: "Section C: Employment",
    type: "single",
    text: "Have you faced any barriers while looking for work in Sault Ste. Marie?",
    visible: (a) => a.employment_status === V5_UNEMP_LOOKING,
    options: ["Yes", "No"],
  },
  {
    id: "unemployment_reasons",
    section: "Section C: Employment",
    type: "multi",
    text: "Select all barriers that apply",
    visible: (a) => a.employment_status === V5_UNEMP_LOOKING && a.unemployed_barrier_gate === "Yes",
    options: V5_UNEMP_REASONS,
  },
  {
    id: "unemployment_reasons_other",
    section: "Section C: Employment",
    type: "text",
    text: "Please specify",
    visible: (a) => a.employment_status === V5_UNEMP_LOOKING && includes(a.unemployment_reasons, "Other"),
  },

  // ── C · NOT looking for work block ──
  {
    id: "not_looking_reasons",
    section: "Section C: Employment",
    type: "multi",
    text: "Why are you not looking for work?",
    visible: (a) => V5_NOT_LOOKING.includes(a.employment_status),
    options: V5_NOTLOOK,
  },
  {
    id: "not_looking_other",
    section: "Section C: Employment",
    type: "text",
    text: "Please specify",
    visible: (a) => V5_NOT_LOOKING.includes(a.employment_status) && includes(a.not_looking_reasons, "Other"),
  },

  // ── C · STUDENT / recent graduate block ──
  {
    id: "student_working",
    section: "Section C: Employment",
    type: "single",
    text: "Are you currently working?",
    visible: (a) => a.employment_status === V5_STUDENT,
    options: ["Yes", "No"],
  },
  {
    id: "student_current_job",
    section: "Section C: Employment",
    type: "picklist",
    text: "What is the title of your current job?",
    placeholder: "Type to search occupations…",
    visible: (a) => a.employment_status === V5_STUDENT && a.student_working === "Yes",
    options: NOC_OCCUPATIONS,
  },
  {
    id: "student_job_relevant",
    section: "Section C: Employment",
    type: "single",
    text: "Is your current job relevant to your current program of study?",
    visible: (a) => a.employment_status === V5_STUDENT && a.student_working === "Yes",
    options: ["Yes", "No"],
  },
  {
    id: "student_job_help",
    section: "Section C: Employment",
    type: "multi",
    text: "What of the following were useful in your job search in Northern Ontario / Sault Ste. Marie? Select all that apply.",
    visible: (a) => a.employment_status === V5_STUDENT && a.student_working === "Yes",
    options: V5_JOBHELP,
  },
  {
    id: "student_job_help_other",
    section: "Section C: Employment",
    type: "text",
    text: "Please specify",
    visible: (a) => a.employment_status === V5_STUDENT && a.student_working === "Yes" && includes(a.student_job_help, "Other"),
  },
  {
    id: "student_barrier_gate",
    section: "Section C: Employment",
    type: "single",
    text: "Have you faced any barriers while looking for jobs in Sault Ste. Marie?",
    visible: (a) => a.employment_status === V5_STUDENT,
    options: ["Yes", "No"],
  },
  {
    id: "student_barriers",
    section: "Section C: Employment",
    type: "multi",
    text: "Select all barriers that apply",
    visible: (a) => a.employment_status === V5_STUDENT && a.student_barrier_gate === "Yes",
    options: V5_BARRIERS,
  },
  {
    id: "student_barriers_other",
    section: "Section C: Employment",
    type: "text",
    text: "Please specify",
    visible: (a) => a.employment_status === V5_STUDENT && a.student_barrier_gate === "Yes" && includes(a.student_barriers, "Other"),
  },
  {
    id: "student_support",
    section: "Section C: Employment",
    type: "multi",
    text: "Which type of support would help you get the job you want? Select all that apply.",
    visible: (a) => a.employment_status === V5_STUDENT && a.student_barrier_gate === "Yes",
    options: V5_SUPPORT,
  },
  {
    id: "student_support_other",
    section: "Section C: Employment",
    type: "text",
    text: "Please specify",
    visible: (a) => a.employment_status === V5_STUDENT && a.student_barrier_gate === "Yes" && includes(a.student_support, "Other"),
  },
  {
    id: "planned_intended_job",
    section: "Section C: Employment",
    type: "picklist",
    text: "What is the title of your intended job after graduation?",
    placeholder: "Type to search occupations…",
    visible: (a) => a.employment_status === V5_STUDENT,
    options: NOC_OCCUPATIONS,
  },

  // ── Section D: Skills ───────────────────────────────────────────────
  {
    id: "skills",
    section: "Section D: Skills",
    type: "rating",
    text: "How would you rate your level for each of the following skills?",
    help: "1 = Lowest, 2 = Low, 3 = Moderate, 4 = High, 5 = Highest, 0 = Not Sure",
    legend: ["1 · Lowest", "5 · Highest"],
    // Skills are specific to the respondent's chosen occupation (OaSIS/NOC7
    // code from the picklist) → noc7_skill_lookup, matching survey v.5.1 (D_noc7).
    visible: (a) => (NOC7_SKILLS[activeOasis7(a)] || []).length > 0,
    skills: (a) => (NOC7_SKILLS[activeOasis7(a)] || []).map((name) => [name, name, ""]),
  },

  // ── Gift card draw ──────────────────────────────────────────────────
  {
    id: "gift_card_draw",
    section: "Gift Card Draw",
    type: "single",
    text: "Do you want to participate in the gift card draw? (For prize purposes only)",
    options: ["Yes", "No"],
  },
];

const SECTIONS = [
  "Consent",
  "Eligibility Check",
  "Section A: Demographics",
  "Section B: Education",
  "Section C: Employment",
  "Section D: Skills",
  "Gift Card Draw",
];

window.SURVEY = { QUESTIONS, SECTIONS, SKILLS, DEFINITIONS: OPTION_DEFINITIONS, HOME_VARIANTS };
