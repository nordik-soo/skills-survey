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

// v5 occupation model: the job-title fields are searchable NOC picklists (no
// sector/group cascade). Each answer holds a "CODE - Occupation" label; parse
// the leading 5-digit NOC code and look up the 10 skills from noc5_skill_lookup
// (loaded via noc-data.js). Skills are keyed by NOC5 code, not occupation group.
const NOC_OCCUPATIONS = ((window.NOC_DATA && window.NOC_DATA.OCCUPATIONS) || []).map((o) => o.label);
const NOC5_SKILLS = (window.NOC_DATA && window.NOC_DATA.SKILLS) || {};
const noc5Of = (label) => String(label || "").split(" - ")[0].trim();
// Matches v5's D_noc5: INTENDED occupation first (working → unemployed →
// student), then the current job as a fallback.
const activeNoc5 = (a) =>
  noc5Of(a.intended_job_title || a.unemployed_intended_job || a.planned_intended_job || a.current_job_title || "");

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
    text: "Did you move to Northern Ontario after December 2021 to live?",
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
    type: "text",
    text: "Please type the country you moved from",
    visible: (a) =>
      a.moved_from === "Outside of Canada with an immigration status" ||
      a.moved_from === "Outside of Canada with non-immigration status",
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
    type: "single",
    text: "Do you identify with any of the following groups?",
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
    text: "What is the FULL NAME of the program you completed for your most recent credential?",
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
    id: "institution_name",
    section: "Section B: Education",
    type: "text",
    text: "Name of the institution (e.g., University/College/School)",
    visible: (a) => a.program_location === "In Canada" || a.program_location === "Outside Canada",
  },
  {
    id: "program_completion_year",
    section: "Section B: Education",
    type: "select",
    text: "When did you complete this program?",
    options: [
      "2026", "2025", "2024", "2023", "2022", "2021", "2020", "2019", "2018",
      "2017", "2016", "2015", "2014", "2013", "2012", "2011", "2010", "2009",
      "2008", "2007", "2006", "2005", "2004", "2003", "2002", "2001", "2000",
      "Before 2000",
    ],
  },
  {
    id: "highest_education",
    section: "Section B: Education",
    type: "single",
    text: "Is this program your highest level of education?",
    options: ["Yes", "No"],
  },
  {
    id: "highest_credential",
    section: "Section B: Education",
    type: "select",
    text: "What is your highest level of education?",
    visible: (a) => a.highest_education === "No",
    options: [
      "College certificate", "Diploma", "Advanced Diploma",
      "Undergraduate degree", "Post-graduate degree (e.g., Master's, PhD, MD)",
    ],
  },
  {
    id: "highest_program_name",
    section: "Section B: Education",
    type: "textarea",
    text: "What is the NAME of the program you completed for your highest level of education?",
    visible: (a) => a.highest_education === "No",
  },

  // ── Section C: Employment ───────────────────────────────────────────
  {
    id: "employed_before",
    section: "Section C: Employment",
    type: "single",
    text: "Were you employed before moving to Sault Ste. Marie?",
    options: ["Yes", "No"],
  },
  {
    id: "previous_job_title",
    section: "Section C: Employment",
    type: "picklist",
    text: "What was the title of your most recent job before moving here?",
    placeholder: "Type to search occupations…",
    visible: (a) => a.employed_before === "Yes",
    options: NOC_OCCUPATIONS,
  },
  {
    id: "previous_job_duties",
    section: "Section C: Employment",
    type: "textarea",
    text: "What were your main duties in that job?",
    visible: (a) => a.employed_before === "Yes",
  },
  {
    id: "employment_status",
    section: "Section C: Employment",
    type: "single",
    text: "Which of the following best describes your current employment status?",
    options: EMPLOYMENT_STATUS,
  },
  {
    id: "individual_income",
    section: "Section C: Employment",
    type: "select",
    text: "What was your total individual income in the past 12 months? (before tax and deductions)",
    options: [
      "No income", "Under $30,000", "$30,000 to $49,999", "$50,000 to $69,999",
      "$70,000 to $89,999", "$90,000 to $109,999", "$110,000 to $129,999",
      "$130,000 to $159,999", "$160,000 or more", "Prefer not to answer",
    ],
  },

  // C — working block (self-employed / casual / part / full time)
  {
    id: "current_job_title",
    section: "Section C: Employment",
    type: "picklist",
    text: "What is the title of your current job?",
    placeholder: "Type to search occupations…",
    visible: (a) => WORKING.includes(a.employment_status),
    options: NOC_OCCUPATIONS,
  },
  {
    id: "months_to_find_first_job",
    section: "Section C: Employment",
    type: "single",
    text: "How many months did it take you to find your first job after arriving?",
    visible: (a) => WORKING.includes(a.employment_status),
    options: MONTHS_RANGE,
  },
  {
    id: "job_search_help",
    section: "Section C: Employment",
    type: "single",
    text: "What helped you the most in your job search?",
    visible: (a) => WORKING.includes(a.employment_status),
    options: [
      "Personal connections", "Networking events", "Employment or settlement agency",
      "Recognition of experience", "Training or certification", "Referral",
      "Social media", "Communication skills", "Other",
    ],
  },
  {
    id: "job_search_other",
    section: "Section C: Employment",
    type: "text",
    text: "Please specify",
    visible: (a) => WORKING.includes(a.employment_status) && includes(a.job_search_help, "Other"),
  },
  {
    id: "intended_job",
    section: "Section C: Employment",
    type: "single",
    text: "Is your current job the one you intended to do?",
    visible: (a) => WORKING.includes(a.employment_status),
    options: ["Yes", "No"],
  },
  {
    id: "intended_job_title",
    section: "Section C: Employment",
    type: "picklist",
    text: "What is your intended job title?",
    placeholder: "Type to search occupations…",
    visible: (a) => WORKING.includes(a.employment_status) && a.intended_job === "No",
    options: NOC_OCCUPATIONS,
  },
  {
    id: "part_time_reasons",
    section: "Section C: Employment",
    type: "single",
    text: "Reasons for part-time/casual employment",
    visible: (a) => PART_OR_CASUAL.includes(a.employment_status),
    options: [
      "Prefer flexible work", "Could not find full-time work", "Could not find work in field",
      "Caregiving responsibilities", "Health reasons", "Lack of local experience",
      "Qualifications not recognized", "Language barriers", "Immigration restrictions",
      "Limited opportunities", "Temporary situation", "Employer offered part-time",
      "Other", "Prefer not to answer",
    ],
  },
  {
    id: "part_time_reasons_other",
    section: "Section C: Employment",
    type: "text",
    text: "Please specify",
    visible: (a) => PART_OR_CASUAL.includes(a.employment_status) && includes(a.part_time_reasons, "Other"),
  },

  // C — unemployed & looking block
  {
    id: "months_unemployed",
    section: "Section C: Employment",
    type: "single",
    text: "How many months have you been unemployed?",
    visible: (a) => a.employment_status === EMP_UNEMP_LOOK,
    options: MONTHS_RANGE,
  },
  {
    id: "unemployment_reasons",
    section: "Section C: Employment",
    type: "single",
    text: "Reasons for unemployment",
    visible: (a) => a.employment_status === EMP_UNEMP_LOOK,
    options: [
      "Lack of Canadian experience", "Credential recognition issue", "Language barriers",
      "Experience not recognized", "Limited opportunities", "Limited network",
      "Lack of information", "Skills mismatch", "Health reasons", "Layoff", "Other",
    ],
  },
  {
    id: "unemployment_reasons_other",
    section: "Section C: Employment",
    type: "text",
    text: "Please specify",
    visible: (a) => a.employment_status === EMP_UNEMP_LOOK && includes(a.unemployment_reasons, "Other"),
  },
  {
    id: "unemployed_intended_job",
    section: "Section C: Employment",
    type: "picklist",
    text: "Intended job title",
    placeholder: "Type to search occupations…",
    visible: (a) => a.employment_status === EMP_UNEMP_LOOK,
    options: NOC_OCCUPATIONS,
  },

  // C — not looking for work block
  {
    id: "not_looking_reasons",
    section: "Section C: Employment",
    type: "single",
    text: "Why are you not looking for work?",
    visible: (a) => NOT_LOOKING.includes(a.employment_status),
    options: [
      "Prefer not to work", "Caregiving responsibilities", "No suitable job",
      "Limited opportunities", "Lack of local experience", "Limited network",
      "Immigration status", "Language barriers", "Low wages", "Transportation issues",
      "Health reasons", "Other", "Prefer not to answer",
    ],
  },
  {
    id: "not_looking_other",
    section: "Section C: Employment",
    type: "text",
    text: "Please specify",
    visible: (a) => NOT_LOOKING.includes(a.employment_status) && includes(a.not_looking_reasons, "Other"),
  },

  // C — student / recent graduate block
  {
    id: "planned_intended_job",
    section: "Section C: Employment",
    type: "picklist",
    text: "Intended job title",
    placeholder: "Type to search occupations…",
    visible: (a) => a.employment_status === EMP_STUDENT,
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
    // Skills are specific to the respondent's chosen occupation (NOC5 code from
    // the picklist) → noc5_skill_lookup, matching Newcomer Survey 2026 v.5.
    visible: (a) => (NOC5_SKILLS[activeNoc5(a)] || []).length > 0,
    skills: (a) => (NOC5_SKILLS[activeNoc5(a)] || []).map((name) => [name, name, ""]),
  },
  {
    id: "local_job_knowledge",
    section: "Section D: Skills",
    type: "single",
    text: "How would you rate your knowledge of local job opportunities?",
    options: RATING_5,
  },
  {
    id: "local_training_knowledge",
    section: "Section D: Skills",
    type: "single",
    text: "How would you rate your knowledge of local training opportunities related to your intended job?",
    options: RATING_5,
  },

  // ── Section E: Barriers and Challenges ──────────────────────────────
  {
    id: "employment_barriers",
    section: "Section E: Barriers and Challenges",
    type: "single",
    text: "What do you think about the main barriers for newcomers to find a job in Sault Ste. Marie?",
    options: [
      "Lack of Canadian experience", "Lack of jobs", "Language barriers",
      "Limited network", "Credentials not recognized", "Lack of job information",
      "Discrimination", "Transportation issues", "Childcare responsibilities", "Other",
    ],
  },
  {
    id: "barriers_other",
    section: "Section E: Barriers and Challenges",
    type: "text",
    text: "Please specify",
    visible: (a) => includes(a.employment_barriers, "Other"),
  },
  {
    id: "helpful_support",
    section: "Section E: Barriers and Challenges",
    type: "single",
    text: "What type of support would help newcomers most to improve their employment opportunities?",
    options: [
      "Credential recognition", "Training or certification", "Language training",
      "Resume/interview support", "Job matching", "Training matching", "Networking",
      "Mentorship", "Childcare support", "Local job market info", "Other",
    ],
  },
  {
    id: "support_other",
    section: "Section E: Barriers and Challenges",
    type: "text",
    text: "Please specify",
    visible: (a) => includes(a.helpful_support, "Other"),
  },
  {
    id: "application_challenges",
    section: "Section E: Barriers and Challenges",
    type: "single",
    text: "What challenges have you experienced when applying for jobs in Sault Ste. Marie?",
    options: [
      "No interview calls", "Resume difficulty", "Finding jobs", "Long job search",
      "Lack of interview skills", "Online application difficulty", "No Canadian references",
      "Language barriers", "No difficulties", "Other",
    ],
  },
  {
    id: "challenges_other",
    section: "Section E: Barriers and Challenges",
    type: "text",
    text: "Please specify",
    visible: (a) => includes(a.application_challenges, "Other"),
  },
  {
    id: "accessed_support_services",
    section: "Section E: Barriers and Challenges",
    type: "single",
    text: "Have you tried to access any job search, training or employment support services?",
    options: ["Yes", "No"],
  },
  {
    id: "service_access_challenges",
    section: "Section E: Barriers and Challenges",
    type: "single",
    text: "Which challenges did you face in accessing these services?",
    visible: (a) => a.accessed_support_services === "Yes",
    options: [
      "Not eligible", "Lack of information", "Not relevant", "Long wait times",
      "Transportation issues", "Difficult access", "Difficult to navigate",
      "Not useful", "High cost", "No challenges", "Other",
    ],
  },
  {
    id: "service_access_other",
    section: "Section E: Barriers and Challenges",
    type: "text",
    text: "Please specify",
    visible: (a) => a.accessed_support_services === "Yes" && includes(a.service_access_challenges, "Other"),
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
  "Section E: Barriers and Challenges",
  "Gift Card Draw",
];

window.SURVEY = { QUESTIONS, SECTIONS, SKILLS, DEFINITIONS: OPTION_DEFINITIONS, HOME_VARIANTS };
