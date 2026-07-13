// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — display-only translation layer.
//
// PRINCIPLE: this file only changes what the respondent SEES. It never changes
// what is stored or how the survey branches. Every answer is still saved as its
// canonical English value; all visibility rules, NOC/OaSIS + CIP lookups, barrier
// gates, and exports keep using English. `language_preference` records the choice.
//
// Missing translations fall back to English automatically, so a partially
// translated language is safe (English shows through the gaps) — but a language
// is only "release ready" once a fluent reviewer has completed and approved it,
// and (for the consent text) it has passed your team's ethics review.
//
// DICTIONARY BUCKETS (per language code):
//   q    question text            keyed by question id — OR a stable message key
//                                 for dynamic text (e.g. "work_barrier.a".."e")
//   o    option labels            keyed by the canonical ENGLISH option value
//   help per-question help text   keyed by question id
//   def  definitions / tooltips   keyed by the English term (the option value)
//   ui   fixed UI / screen text   keyed by the source ENGLISH string (gettext-style)
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  // Canonical English language name (as stored in language_preference) → code.
  // Config only — no database migration needed to store codes.
  const LANG_CODES = {
    English: "en", French: "fr", Italian: "it", Punjabi: "pa", Spanish: "es",
    Arabic: "ar", Finnish: "fi", Mandarin: "zh", Gujarati: "gu", Hindi: "hi",
    Malayalam: "ml", Portuguese: "pt", Tagalog: "tl", Kurdish: "ku", Polish: "pl",
    German: "de", Tamil: "ta", Bengali: "bn", Urdu: "ur", Ukrainian: "uk",
  };

  // Native display name for the language selector (shown to the respondent while
  // the stored value stays the canonical English name above).
  const NATIVE_NAMES = {
    English: "English", French: "Français", Italian: "Italiano", Punjabi: "ਪੰਜਾਬੀ",
    Spanish: "Español", Arabic: "العربية", Finnish: "Suomi", Mandarin: "中文",
    Gujarati: "ગુજરાતી", Hindi: "हिन्दी", Malayalam: "മലയാളം", Portuguese: "Português",
    Tagalog: "Tagalog", Kurdish: "Kurdî", Polish: "Polski", German: "Deutsch",
    Tamil: "தமிழ்", Bengali: "বাংলা", Urdu: "اردو", Ukrainian: "Українська",
  };

  // Right-to-left languages (layout mode — wired later in Phase 2).
  const RTL = new Set(["ar", "ur", "ku"]);

  // ── Dictionaries, keyed by language code ──────────────────────────────────
  // English is the source and is NOT listed here (it's the fallback).
  //
  // ⚠ `fr` below is a COMPLETE DRAFT translation, NOT yet reviewed. It covers all
  // questions (incl. the five barrier-gate wordings), options, help, definitions,
  // and UI/screen strings. It must be checked by a fluent reviewer before public
  // release, and the consent wording (`q.consent` + the consent privacy strings in
  // `ui`) must pass the team's ethics review. Deferred (stay English by decision):
  // NOC/OaSIS occupations, CIP areas of study, country names, and skill names.
  // Numeric age ranges (e.g. "18-24") are identical in French, so they aren't listed
  // and fall through to the English source.
  //
  // Keys:
  //   q    — question id, e.g. `consent`; dynamic barrier gate uses `work_barrier.a`..`e`
  //   o    — the canonical ENGLISH option value
  //   help — question id
  //   def  — the English term (the option value the tooltip explains)
  //   ui   — the source ENGLISH string
  const DICT = {
    fr: {
      "q": {
        "language": "Sélectionnez une langue pour continuer",
        "consent": "Veuillez confirmer que vous avez au moins 18 ans et que vous acceptez de participer volontairement à ce sondage.",
        "eligible": "Avez-vous déménagé dans le Nord de l'Ontario après septembre 2021 pour y vivre ?",
        "moved_from": "D'où avez-vous déménagé ?",
        "province": "Veuillez sélectionner la province d'où vous avez déménagé",
        "country_moved_from": "Veuillez sélectionner le pays d'où vous avez déménagé",
        "gender": "Quel est votre genre ?",
        "age_group": "Quel est votre groupe d'âge ?",
        "identity_groups": "Vous identifiez-vous à l'un des groupes suivants ? Sélectionnez tout ce qui s'applique.",
        "immigration_category": "Sélectionnez votre catégorie d'immigration",
        "non_permanent_category": "Sélectionnez votre catégorie de résident non permanent",
        "non_permanent_other": "Veuillez préciser",
        "recent_credential": "Quel est le diplôme le plus récent que vous avez obtenu ?",
        "program_name": "Quel était votre principal domaine d'études ?",
        "program_name_other": "Veuillez saisir votre principal domaine d'études",
        "program_location": "Où avez-vous suivi ce programme ?",
        "highest_education": "Ce programme correspond-il à votre plus haut niveau d'études ?",
        "highest_credential": "Quel est votre plus haut niveau d'études ?",
        "highest_program_name": "Pour votre plus haut niveau d'études, quel était votre principal domaine d'études ?",
        "highest_program_name_other": "Veuillez saisir votre principal domaine d'études pour votre plus haut niveau d'études",
        "current_program": "Quel est votre programme d'études actuel ?",
        "current_program_name": "Quel est votre principal domaine d'études ?",
        "current_program_name_other": "Veuillez saisir votre principal domaine d'études",
        "employed_before": "Occupiez-vous un emploi au Canada avant de déménager à Sault Ste. Marie ?",
        "previous_job_title": "Quelle était votre dernière profession avant de déménager à Sault Ste. Marie ?",
        "home_emp_before": "Occupiez-vous un emploi dans votre pays d'origine avant de venir au Canada ?",
        "home_country_job": "Quelle était votre dernière profession dans votre pays d'origine ?",
        "employment_status": "Parmi les énoncés suivants, lequel décrit le mieux votre situation d'emploi actuelle ?",
        "current_job_title": "Quel est l'intitulé de votre emploi actuel ?",
        "intended_job": "Votre emploi actuel est-il celui que vous souhaitiez exercer ?",
        "intended_job_title": "Quel est l'intitulé de l'emploi que vous souhaitez exercer ?",
        "job_search_help": "Parmi les éléments suivants, lesquels vous ont été utiles dans votre recherche d'emploi dans le Nord de l'Ontario / à Sault Ste. Marie ? Sélectionnez tout ce qui s'applique.",
        "job_search_other": "Veuillez préciser",
        "work_barriers": "Sélectionnez tous les obstacles qui s'appliquent",
        "work_barriers_other": "Veuillez préciser",
        "work_support": "Quel type de soutien vous aiderait à obtenir l'emploi que vous souhaitez ? Sélectionnez tout ce qui s'applique.",
        "work_support_other": "Veuillez préciser",
        "unemployed_intended_job": "Quel est l'intitulé de l'emploi que vous souhaitez exercer ?",
        "unemployed_barrier_gate": "Avez-vous rencontré des obstacles dans votre recherche d'emploi à Sault Ste. Marie ?",
        "unemployment_reasons": "Sélectionnez tous les obstacles qui s'appliquent",
        "unemployment_reasons_other": "Veuillez préciser",
        "not_looking_reasons": "Pourquoi ne cherchez-vous pas d'emploi ?",
        "not_looking_other": "Veuillez préciser",
        "student_working": "Travaillez-vous actuellement ?",
        "student_current_job": "Quel est l'intitulé de votre emploi actuel ?",
        "student_job_relevant": "Votre emploi actuel est-il en lien avec votre programme d'études actuel ?",
        "student_job_help": "Parmi les éléments suivants, lesquels vous ont été utiles dans votre recherche d'emploi dans le Nord de l'Ontario / à Sault Ste. Marie ? Sélectionnez tout ce qui s'applique.",
        "student_job_help_other": "Veuillez préciser",
        "student_barrier_gate": "Avez-vous rencontré des obstacles dans votre recherche d'emploi à Sault Ste. Marie ?",
        "student_barriers": "Sélectionnez tous les obstacles qui s'appliquent",
        "student_barriers_other": "Veuillez préciser",
        "student_support": "Quel type de soutien vous aiderait à obtenir l'emploi que vous souhaitez ? Sélectionnez tout ce qui s'applique.",
        "student_support_other": "Veuillez préciser",
        "planned_intended_job": "Quel est l'intitulé de l'emploi que vous souhaitez exercer après l'obtention de votre diplôme ?",
        "skills": "Comment évalueriez-vous votre niveau pour chacune des compétences suivantes ?",
        "gift_card_draw": "Souhaitez-vous participer au tirage de cartes-cadeaux ? (À des fins de prix uniquement)",
        "work_barrier.a": "Y a-t-il un obstacle qui vous empêche de travailler à temps plein ?",
        "work_barrier.b": "Y a-t-il un obstacle qui vous empêche d'obtenir l'emploi que vous souhaitez ?",
        "work_barrier.c": "Y a-t-il un obstacle qui vous empêche de travailler à temps plein et d'exercer l'emploi que vous souhaitez ?",
        "work_barrier.d": "Y a-t-il un obstacle qui vous empêche d'obtenir un emploi à temps plein ?",
        "work_barrier.e": "Y a-t-il un obstacle qui vous empêche d'exercer l'emploi que vous souhaitez ?"
      },
      "o": {
        "I agree": "J'accepte",
        "I disagree": "Je refuse",
        "Yes": "Oui",
        "No": "Non",
        "Other parts of Ontario": "D'autres régions de l'Ontario",
        "Outside of Ontario but within Canada": "À l'extérieur de l'Ontario mais au Canada",
        "Outside of Canada with an immigration status": "À l'extérieur du Canada avec un statut d'immigration",
        "Outside of Canada with non-immigration status": "À l'extérieur du Canada sans statut d'immigration",
        "Alberta": "Alberta",
        "British Columbia": "Colombie-Britannique",
        "Manitoba": "Manitoba",
        "New Brunswick": "Nouveau-Brunswick",
        "Newfoundland and Labrador": "Terre-Neuve-et-Labrador",
        "Northwest Territories": "Territoires du Nord-Ouest",
        "Nova Scotia": "Nouvelle-Écosse",
        "Nunavut": "Nunavut",
        "Prince Edward Island": "Île-du-Prince-Édouard",
        "Quebec": "Québec",
        "Saskatchewan": "Saskatchewan",
        "Yukon": "Yukon",
        "Woman": "Femme",
        "Man": "Homme",
        "Non-binary person or other gender": "Personne non binaire ou autre genre",
        "85 or older": "85 ans ou plus",
        "Immigrant (permanent resident)": "Immigrant (résident permanent)",
        "Indigenous (First Nations, Métis, Inuit/Inuk)": "Autochtone (Premières Nations, Métis, Inuit/Inuk)",
        "Non-permanent resident (e.g., work permit, study permit, refugee claimant)": "Résident non permanent (p. ex. permis de travail, permis d'études, demandeur d'asile)",
        "Visible minority (e.g., South Asian, Chinese, Black)": "Minorité visible (p. ex. Sud-Asiatique, Chinois, Noir)",
        "None of the above (do not select any other options)": "Aucune de ces réponses (ne sélectionnez aucune autre option)",
        "Economic Immigrant": "Immigrant économique",
        "Family Sponsored": "Parrainé par la famille",
        "Refugee": "Réfugié",
        "International Student": "Étudiant international",
        "Protected Person": "Personne protégée",
        "Refugee Claimant": "Demandeur d'asile",
        "Temporary Foreign Worker": "Travailleur étranger temporaire",
        "Temporary Resident Permit Holder": "Titulaire d'un permis de séjour temporaire",
        "Other": "Autre",
        "Primary school": "École primaire",
        "High school diploma or equivalent": "Diplôme d'études secondaires ou équivalent",
        "Apprenticeship": "Apprentissage",
        "College certificate": "Certificat collégial",
        "Diploma": "Diplôme",
        "Advanced Diploma": "Diplôme avancé",
        "Undergraduate degree": "Diplôme de premier cycle",
        "Post-graduate degree (e.g., Master's, PhD, MD)": "Diplôme d'études supérieures (p. ex. maîtrise, doctorat, M.D.)",
        "In Canada": "Au Canada",
        "Outside Canada": "À l'extérieur du Canada",
        "Post-graduate degree (e.g., Master's)": "Diplôme d'études supérieures (p. ex. maîtrise)",
        "I directly moved to Sault": "J'ai déménagé directement à Sault",
        "I didn't have a work permit": "Je n'avais pas de permis de travail",
        "Employed casual (less than 10 hours/week)": "Emploi occasionnel (moins de 10 heures/semaine)",
        "Employed full time (30+ hours/week)": "Emploi à temps plein (30 heures et plus/semaine)",
        "Employed part time (10-30 hours/week)": "Emploi à temps partiel (10 à 30 heures/semaine)",
        "Household work / Caregiver": "Travail domestique / Aidant",
        "On temporary leave from a job (e.g., maternity/parental leave)": "En congé temporaire d'un emploi (p. ex. congé de maternité ou parental)",
        "Retired": "Retraité",
        "Self-employed": "Travailleur autonome",
        "Student or recent graduate": "Étudiant ou diplômé récent",
        "Unable to work": "Incapable de travailler",
        "Unemployed and actively looking for work": "Sans emploi et à la recherche active d'un emploi",
        "Unemployed and not looking for work": "Sans emploi et ne cherchant pas d'emploi",
        "Canadian degree or training": "Diplôme ou formation canadienne",
        "Canadian work experience": "Expérience de travail canadienne",
        "Employment or settlement centre": "Centre d'emploi ou d'établissement",
        "Internship / volunteer experience": "Stage / expérience de bénévolat",
        "Local job boards": "Babillards d'emplois locaux",
        "Personal contacts": "Contacts personnels",
        "Professional network": "Réseau professionnel",
        "Recognition of non-Canadian work experience": "Reconnaissance de l'expérience de travail non canadienne",
        "Social media (e.g., LinkedIn)": "Médias sociaux (p. ex. LinkedIn)",
        "Caregiving responsibilities": "Responsabilités d'aidant",
        "Credentials not recognized": "Titres de compétence non reconnus",
        "Discrimination of any kind": "Discrimination de toute nature",
        "Health issues": "Problèmes de santé",
        "Household responsibilities": "Responsabilités familiales",
        "Lack of Canadian work experience": "Manque d'expérience de travail canadienne",
        "Lack of skills for available jobs": "Manque de compétences pour les emplois disponibles",
        "Language barriers": "Barrières linguistiques",
        "Limited job opportunities in preferred sector": "Possibilités d'emploi limitées dans le secteur souhaité",
        "Limited knowledge of local job market": "Connaissance limitée du marché du travail local",
        "Limited mentorship and job-matching support": "Soutien limité en mentorat et en jumelage d'emplois",
        "Limited professional network": "Réseau professionnel limité",
        "Childcare support": "Aide à la garde d'enfants",
        "Credential recognition support": "Soutien à la reconnaissance des titres de compétence",
        "Language support": "Soutien linguistique",
        "Local job market information": "Information sur le marché du travail local",
        "Local training or certification": "Formation ou certification locale",
        "Mentorship support": "Soutien en mentorat",
        "Networking support": "Soutien au réseautage",
        "Resume/interview support": "Soutien pour le CV et les entrevues",
        "Skills-to-job matching platform": "Plateforme de jumelage compétences-emplois",
        "Training recommendations": "Recommandations de formation",
        "Non-Canadian work experience not recognized": "Expérience de travail non canadienne non reconnue",
        "Doesn’t need employment income": "N'a pas besoin de revenu d'emploi",
        "Health reasons": "Raisons de santé",
        "Immigration issues": "Problèmes d'immigration",
        "Limited suitable jobs": "Emplois convenables limités",
        "Low wages": "Bas salaires",
        "Not qualified for available jobs": "Non qualifié pour les emplois disponibles"
      },
      "help": {
        "skills": "1 = le plus bas, 2 = bas, 3 = modéré, 4 = élevé, 5 = le plus élevé, 0 = incertain"
      },
      "def": {
        "Family Sponsored": "Vous avez immigré parce qu'un membre de votre famille déjà au Canada vous a parrainé.",
        "Economic Immigrant": "Vous avez immigré dans le cadre d'un programme de travailleurs qualifiés ou d'affaires (p. ex. Entrée express, Programme des candidats des provinces).",
        "Refugee": "Vous êtes venu au Canada pour être protégé d'un danger dans votre pays d'origine.",
        "Temporary Foreign Worker": "Au Canada avec un permis de travail lié à un employeur ou un permis de travail ouvert.",
        "Refugee Claimant": "Vous avez demandé l'asile au Canada et attendez une décision.",
        "Protected Person": "Le Canada a déjà reconnu que vous avez besoin de protection (statut de réfugié ou de personne protégée approuvé).",
        "Temporary Resident Permit Holder": "Vous détenez un permis spécial vous permettant de rester temporairement alors que ce ne serait normalement pas autorisé.",
        "Employment or settlement agency": "Un organisme qui aide les gens à trouver du travail ou aide les nouveaux arrivants à s'établir au Canada.",
        "Recognition of experience": "Un employeur qui accepte et valorise l'expérience de travail que vous avez acquise auparavant.",
        "Networking events": "Des événements où vous rencontrez des personnes de votre domaine pour établir des contacts professionnels.",
        "Lack of local experience": "Vous n'avez pas encore travaillé au Canada ou dans cette région, ce que les employeurs demandent souvent.",
        "Lack of Canadian experience": "Vous n'avez pas encore travaillé au Canada ou dans cette région, ce que les employeurs demandent souvent.",
        "Qualifications not recognized": "Votre formation, votre permis ou votre expérience d'un autre pays n'est pas reconnu ici.",
        "Credential recognition issue": "Votre formation, votre permis ou votre expérience d'un autre pays n'est pas reconnu ici.",
        "Experience not recognized": "Votre formation, votre permis ou votre expérience d'un autre pays n'est pas reconnu ici.",
        "Immigration restrictions": "Les conditions de votre permis ou de votre statut limitent le travail ou les heures que vous pouvez faire.",
        "Immigration status": "Les conditions de votre permis ou de votre statut limitent le travail ou les heures que vous pouvez faire.",
        "Skills mismatch": "Vos compétences ne correspondent pas aux emplois offerts localement.",
        "Limited network": "Vous ne connaissez pas beaucoup de personnes pouvant vous mettre en contact avec des emplois.",
        "Credential recognition": "De l'aide pour faire reconnaître au Canada votre formation ou votre permis étranger.",
        "Job matching": "Un service qui vous met en contact avec des offres d'emploi convenables.",
        "Training matching": "Un service qui vous met en contact avec des programmes de formation convenables."
      },
      "ui": {
        "Search or select a language": "Rechercher ou sélectionner une langue",
        "Type to search countries…": "Tapez pour rechercher un pays…",
        "Type to search areas of study…": "Tapez pour rechercher un domaine d'études…",
        "Type to search occupations…": "Tapez pour rechercher une profession…",
        "1 · Lowest": "1 · le plus bas",
        "5 · Highest": "5 · le plus élevé",
        "% complete": " % complété",
        "Finish to become a Survey Champion": "Terminez pour devenir un champion du sondage",
        "You opened a personal invitation link, so your completion may be recorded for reminder purposes. Your responses are kept confidential and analyzed in de-identified form.": "Vous avez ouvert un lien d'invitation personnel; votre participation peut donc être enregistrée à des fins de rappel. Vos réponses demeurent confidentielles et sont analysées de façon anonymisée.",
        "Your responses are anonymous.": "Vos réponses sont anonymes.",
        "Previous question": "Question précédente",
        "Next question": "Question suivante",
        "Next 5 skills": "5 compétences suivantes",
        "Back": "Retour",
        "Submit": "Soumettre",
        "Definition:": "Définition :",
        "No matches": "Aucun résultat",
        "more — keep typing to narrow": "de plus — continuez à taper pour affiner",
        "Not sure": "Incertain",
        "Yes, enter me in the gift-card draw": "Oui, inscrivez-moi au tirage de cartes-cadeaux",
        "Five $50 local gift cards drawn monthly": "Cinq cartes-cadeaux locales de 50 $ tirées chaque mois",
        "Email address": "Adresse courriel",
        "Consent is required to continue": "Le consentement est requis pour continuer",
        "To take part, you must be at least 18 years old and agree to participate. If you'd like to continue, you can go back and change your answer.": "Pour participer, vous devez avoir au moins 18 ans et accepter de participer. Si vous souhaitez continuer, vous pouvez revenir en arrière et modifier votre réponse.",
        "Go back": "Retour",
        "Home": "Accueil",
        "Thank you for your time and response": "Merci de votre temps et de votre réponse",
        "You made a great contribution to the development of the community": "Vous avez grandement contribué au développement de la communauté",
        "Go home": "Accueil",
        "Halfway there": "À mi-chemin",
        "Thank you for sharing your experience.": "Merci d'avoir partagé votre expérience.",
        "You've already completed this survey": "Vous avez déjà rempli ce sondage",
        "Thank you — your response has been recorded. There's no need to fill it out again.": "Merci — votre réponse a été enregistrée. Il n'est pas nécessaire de la remplir à nouveau.",
        "Saving your response…": "Enregistrement de votre réponse…",
        "One moment.": "Un instant.",
        "You're a Survey Champion": "Vous êtes un champion du sondage",
        "Thank you for your time and response. You made a great contribution to the development of the community.": "Merci de votre temps et de votre réponse. Vous avez grandement contribué au développement de la communauté.",
        "Back to home": "Retour à l'accueil",
        "We couldn't save your response": "Nous n'avons pas pu enregistrer votre réponse",
        "Something went wrong reaching the server. Your answers are still saved on this device — please try again.": "Une erreur s'est produite lors de la connexion au serveur. Vos réponses sont toujours enregistrées sur cet appareil — veuillez réessayer.",
        "Try again": "Réessayer",
        "Type to search…": "Tapez pour rechercher…",
        "Select one…": "Sélectionnez une option…"
      }
    },
  };

  const codeFor = (name) => LANG_CODES[name] || "en";
  const dictFor = (code) => (code !== "en" && DICT[code]) || null;
  // generic lookup with English fallback
  const pick = (bucket, key, english, code) => {
    const d = dictFor(code);
    return (d && d[bucket] && d[bucket][key]) || english;
  };

  window.I18N = {
    LANG_CODES,
    NATIVE_NAMES,
    code: codeFor,
    isRTL: (code) => RTL.has(code),
    native: (name) => NATIVE_NAMES[name] || name,
    // question text by id OR dynamic message key
    q: (key, english, code) => pick("q", key, english, code),
    // option label by canonical English value
    o: (value, code) => pick("o", value, value, code),
    // per-question help text by question id
    help: (id, english, code) => pick("help", id, english, code),
    // definition / tooltip by English term
    def: (term, english, code) => pick("def", term, english, code),
    // fixed UI / screen string by its source English text
    ui: (text, code) => pick("ui", text, text, code),
  };
})();
