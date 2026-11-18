#!/usr/bin/env python3
"""
Wording the app needs that the uploaded questionnaires do not contain.

The eight masters carry the questions, their options, the homepage, the
information letter, the consent statements and the definitions appendix. Four
lists are NOT in them and would otherwise fall back to English:

  * the 195-country picklist            (the documents say "See Picklist 1")
  * the 33 NOC skill names              (the documents say "Skill 1" ... "Skill 9")
  * the 33 skill definitions
  * the eight section titles

Each table is one line per entry, columns separated by "|":
    English | es | fr | it | pt | ar | zh | hi | tl

Nothing here is copied from the documents; it is authored wording, kept in one
place so a reviewer can read it column by column.
"""

CODES = ["es", "fr", "it", "pt", "ar", "zh", "hi", "tl"]


def parse(table: str) -> dict[str, dict[str, str]]:
    out: dict[str, dict[str, str]] = {}
    for line in table.strip().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) != len(CODES) + 1:
            raise SystemExit(f"bad row ({len(parts)} columns): {line[:60]}")
        en, rest = parts[0], parts[1:]
        if any(not v for v in rest):
            raise SystemExit(f"empty translation: {en}")
        out[en] = dict(zip(CODES, rest))
    return out


# ── the country picklist ───────────────────────────────────────────────────
COUNTRIES = parse("""
Afghanistan|Afganistán|Afghanistan|Afghanistan|Afeganistão|أفغانستان|阿富汗|अफ़ग़ानिस्तान|Afghanistan
Albania|Albania|Albanie|Albania|Albânia|ألبانيا|阿尔巴尼亚|अल्बानिया|Albanya
Algeria|Argelia|Algérie|Algeria|Argélia|الجزائر|阿尔及利亚|अल्जीरिया|Algeria
Andorra|Andorra|Andorre|Andorra|Andorra|أندورا|安道尔|अंडोरा|Andorra
Angola|Angola|Angola|Angola|Angola|أنغولا|安哥拉|अंगोला|Angola
Antigua and Barbuda|Antigua y Barbuda|Antigua-et-Barbuda|Antigua e Barbuda|Antígua e Barbuda|أنتيغوا وبربودا|安提瓜和巴布达|एंटीगुआ और बारबुडा|Antigua at Barbuda
Argentina|Argentina|Argentine|Argentina|Argentina|الأرجنتين|阿根廷|अर्जेंटीना|Argentina
Armenia|Armenia|Arménie|Armenia|Armênia|أرمينيا|亚美尼亚|आर्मेनिया|Armenia
Australia|Australia|Australie|Australia|Austrália|أستراليا|澳大利亚|ऑस्ट्रेलिया|Australia
Austria|Austria|Autriche|Austria|Áustria|النمسا|奥地利|ऑस्ट्रिया|Austria
Azerbaijan|Azerbaiyán|Azerbaïdjan|Azerbaigian|Azerbaijão|أذربيجان|阿塞拜疆|अज़रबैजान|Azerbaijan
Bahamas|Bahamas|Bahamas|Bahamas|Bahamas|جزر البهاما|巴哈马|बहामास|Bahamas
Bahrain|Baréin|Bahreïn|Bahrein|Bahrein|البحرين|巴林|बहरीन|Bahrain
Bangladesh|Bangladés|Bangladesh|Bangladesh|Bangladesh|بنغلاديش|孟加拉国|बांग्लादेश|Bangladesh
Barbados|Barbados|Barbade|Barbados|Barbados|بربادوس|巴巴多斯|बारबाडोस|Barbados
Belarus|Bielorrusia|Biélorussie|Bielorussia|Bielorrússia|بيلاروسيا|白俄罗斯|बेलारूस|Belarus
Belgium|Bélgica|Belgique|Belgio|Bélgica|بلجيكا|比利时|बेल्जियम|Belgium
Belize|Belice|Belize|Belize|Belize|بليز|伯利兹|बेलीज़|Belize
Benin|Benín|Bénin|Benin|Benim|بنين|贝宁|बेनिन|Benin
Bhutan|Bután|Bhoutan|Bhutan|Butão|بوتان|不丹|भूटान|Bhutan
Bolivia|Bolivia|Bolivie|Bolivia|Bolívia|بوليفيا|玻利维亚|बोलीविया|Bolivia
Bosnia and Herzegovina|Bosnia y Herzegovina|Bosnie-Herzégovine|Bosnia ed Erzegovina|Bósnia e Herzegovina|البوسنة والهرسك|波斯尼亚和黑塞哥维那|बोस्निया और हर्ज़ेगोविना|Bosnia at Herzegovina
Botswana|Botsuana|Botswana|Botswana|Botsuana|بوتسوانا|博茨瓦纳|बोत्सवाना|Botswana
Brazil|Brasil|Brésil|Brasile|Brasil|البرازيل|巴西|ब्राज़ील|Brazil
Brunei|Brunéi|Brunei|Brunei|Brunei|بروناي|文莱|ब्रुनेई|Brunei
Bulgaria|Bulgaria|Bulgarie|Bulgaria|Bulgária|بلغاريا|保加利亚|बुल्गारिया|Bulgaria
Burkina Faso|Burkina Faso|Burkina Faso|Burkina Faso|Burkina Faso|بوركينا فاسو|布基纳法索|बुर्किना फ़ासो|Burkina Faso
Burundi|Burundi|Burundi|Burundi|Burundi|بوروندي|布隆迪|बुरुंडी|Burundi
Cabo Verde|Cabo Verde|Cabo Verde|Capo Verde|Cabo Verde|الرأس الأخضر|佛得角|काबो वर्डे|Cabo Verde
Cambodia|Camboya|Cambodge|Cambogia|Camboja|كمبوديا|柬埔寨|कंबोडिया|Cambodia
Cameroon|Camerún|Cameroun|Camerun|Camarões|الكاميرون|喀麦隆|कैमरून|Cameroon
Canada|Canadá|Canada|Canada|Canadá|كندا|加拿大|कनाडा|Canada
Central African Republic|República Centroafricana|République centrafricaine|Repubblica Centrafricana|República Centro-Africana|جمهورية أفريقيا الوسطى|中非共和国|मध्य अफ़्रीकी गणराज्य|Republikang Gitnang Aprika
Chad|Chad|Tchad|Ciad|Chade|تشاد|乍得|चाड|Chad
Chile|Chile|Chili|Cile|Chile|تشيلي|智利|चिली|Chile
China|China|Chine|Cina|China|الصين|中国|चीन|China
Colombia|Colombia|Colombie|Colombia|Colômbia|كولومبيا|哥伦比亚|कोलंबिया|Colombia
Comoros|Comoras|Comores|Comore|Comores|جزر القمر|科摩罗|कोमोरोस|Comoros
Congo (Democratic Republic)|República Democrática del Congo|République démocratique du Congo|Repubblica Democratica del Congo|República Democrática do Congo|جمهورية الكونغو الديمقراطية|刚果民主共和国|कांगो लोकतांत्रिक गणराज्य|Demokratikong Republika ng Congo
Congo (Republic)|República del Congo|République du Congo|Repubblica del Congo|República do Congo|جمهورية الكونغو|刚果共和国|कांगो गणराज्य|Republika ng Congo
Costa Rica|Costa Rica|Costa Rica|Costa Rica|Costa Rica|كوستاريكا|哥斯达黎加|कोस्टा रिका|Costa Rica
Croatia|Croacia|Croatie|Croazia|Croácia|كرواتيا|克罗地亚|क्रोएशिया|Croatia
Cuba|Cuba|Cuba|Cuba|Cuba|كوبا|古巴|क्यूबा|Cuba
Cyprus|Chipre|Chypre|Cipro|Chipre|قبرص|塞浦路斯|साइप्रस|Cyprus
Czech Republic (Czechia)|República Checa (Chequia)|République tchèque (Tchéquie)|Repubblica Ceca (Cechia)|República Tcheca (Chéquia)|جمهورية التشيك (تشيكيا)|捷克共和国（捷克）|चेक गणराज्य (चेकिया)|Republikang Czech (Czechia)
Denmark|Dinamarca|Danemark|Danimarca|Dinamarca|الدنمارك|丹麦|डेनमार्क|Denmark
Djibouti|Yibuti|Djibouti|Gibuti|Djibuti|جيبوتي|吉布提|जिबूती|Djibouti
Dominica|Dominica|Dominique|Dominica|Dominica|دومينيكا|多米尼克|डोमिनिका|Dominica
Dominican Republic|República Dominicana|République dominicaine|Repubblica Dominicana|República Dominicana|جمهورية الدومينيكان|多米尼加共和国|डोमिनिकन गणराज्य|Republikang Dominikano
Ecuador|Ecuador|Équateur|Ecuador|Equador|الإكوادور|厄瓜多尔|इक्वाडोर|Ecuador
Egypt|Egipto|Égypte|Egitto|Egito|مصر|埃及|मिस्र|Egypt
El Salvador|El Salvador|El Salvador|El Salvador|El Salvador|السلفادور|萨尔瓦多|अल सल्वाडोर|El Salvador
Equatorial Guinea|Guinea Ecuatorial|Guinée équatoriale|Guinea Equatoriale|Guiné Equatorial|غينيا الاستوائية|赤道几内亚|इक्वेटोरियल गिनी|Ekwatoryal na Guinea
Eritrea|Eritrea|Érythrée|Eritrea|Eritreia|إريتريا|厄立特里亚|इरित्रिया|Eritrea
Estonia|Estonia|Estonie|Estonia|Estônia|إستونيا|爱沙尼亚|एस्टोनिया|Estonia
Eswatini (Swaziland)|Esuatini (Suazilandia)|Eswatini (Swaziland)|Eswatini (Swaziland)|Essuatíni (Suazilândia)|إسواتيني (سوازيلاند)|埃斯瓦蒂尼（斯威士兰）|एस्वातिनी (स्वाज़ीलैंड)|Eswatini (Swaziland)
Ethiopia|Etiopía|Éthiopie|Etiopia|Etiópia|إثيوبيا|埃塞俄比亚|इथियोपिया|Ethiopia
Fiji|Fiyi|Fidji|Figi|Fiji|فيجي|斐济|फ़िजी|Fiji
Finland|Finlandia|Finlande|Finlandia|Finlândia|فنلندا|芬兰|फ़िनलैंड|Finland
France|Francia|France|Francia|França|فرنسا|法国|फ़्रांस|France
Gabon|Gabón|Gabon|Gabon|Gabão|الغابون|加蓬|गैबॉन|Gabon
Gambia|Gambia|Gambie|Gambia|Gâmbia|غامبيا|冈比亚|गाम्बिया|Gambia
Georgia|Georgia|Géorgie|Georgia|Geórgia|جورجيا|格鲁吉亚|जॉर्जिया|Georgia
Germany|Alemania|Allemagne|Germania|Alemanha|ألمانيا|德国|जर्मनी|Alemanya
Ghana|Ghana|Ghana|Ghana|Gana|غانا|加纳|घाना|Ghana
Greece|Grecia|Grèce|Grecia|Grécia|اليونان|希腊|यूनान|Greece
Grenada|Granada|Grenade|Grenada|Granada|غرينادا|格林纳达|ग्रेनेडा|Grenada
Guatemala|Guatemala|Guatemala|Guatemala|Guatemala|غواتيمالا|危地马拉|ग्वाटेमाला|Guatemala
Guinea|Guinea|Guinée|Guinea|Guiné|غينيا|几内亚|गिनी|Guinea
Guinea-Bissau|Guinea-Bisáu|Guinée-Bissau|Guinea-Bissau|Guiné-Bissau|غينيا بيساو|几内亚比绍|गिनी-बिसाऊ|Guinea-Bissau
Guyana|Guyana|Guyana|Guyana|Guiana|غيانا|圭亚那|गुयाना|Guyana
Haiti|Haití|Haïti|Haiti|Haiti|هايتي|海地|हैती|Haiti
Honduras|Honduras|Honduras|Honduras|Honduras|هندوراس|洪都拉斯|होंडुरास|Honduras
Hungary|Hungría|Hongrie|Ungheria|Hungria|المجر|匈牙利|हंगरी|Hungary
Iceland|Islandia|Islande|Islanda|Islândia|آيسلندا|冰岛|आइसलैंड|Iceland
India|India|Inde|India|Índia|الهند|印度|भारत|India
Indonesia|Indonesia|Indonésie|Indonesia|Indonésia|إندونيسيا|印度尼西亚|इंडोनेशिया|Indonesia
Iran|Irán|Iran|Iran|Irã|إيران|伊朗|ईरान|Iran
Iraq|Irak|Irak|Iraq|Iraque|العراق|伊拉克|इराक़|Iraq
Ireland|Irlanda|Irlande|Irlanda|Irlanda|أيرلندا|爱尔兰|आयरलैंड|Ireland
Israel|Israel|Israël|Israele|Israel|إسرائيل|以色列|इज़राइल|Israel
Italy|Italia|Italie|Italia|Itália|إيطاليا|意大利|इटली|Italya
Ivory Coast (Cote d'Ivoire)|Costa de Marfil (Côte d'Ivoire)|Côte d'Ivoire|Costa d'Avorio (Côte d'Ivoire)|Costa do Marfim (Côte d'Ivoire)|كوت ديفوار (ساحل العاج)|科特迪瓦（象牙海岸）|कोट द'आइवरी (आइवरी कोस्ट)|Ivory Coast (Cote d'Ivoire)
Jamaica|Jamaica|Jamaïque|Giamaica|Jamaica|جامايكا|牙买加|जमैका|Jamaica
Japan|Japón|Japon|Giappone|Japão|اليابان|日本|जापान|Japan
Jordan|Jordania|Jordanie|Giordania|Jordânia|الأردن|约旦|जॉर्डन|Jordan
Kazakhstan|Kazajistán|Kazakhstan|Kazakistan|Cazaquistão|كازاخستان|哈萨克斯坦|कज़ाख़िस्तान|Kazakhstan
Kenya|Kenia|Kenya|Kenya|Quênia|كينيا|肯尼亚|केन्या|Kenya
Kiribati|Kiribati|Kiribati|Kiribati|Kiribati|كيريباتي|基里巴斯|किरिबाती|Kiribati
Kuwait|Kuwait|Koweït|Kuwait|Kuwait|الكويت|科威特|कुवैत|Kuwait
Kyrgyzstan|Kirguistán|Kirghizistan|Kirghizistan|Quirguistão|قيرغيزستان|吉尔吉斯斯坦|किर्गिज़स्तान|Kyrgyzstan
Laos|Laos|Laos|Laos|Laos|لاوس|老挝|लाओस|Laos
Latvia|Letonia|Lettonie|Lettonia|Letônia|لاتفيا|拉脱维亚|लातविया|Latvia
Lebanon|Líbano|Liban|Libano|Líbano|لبنان|黎巴嫩|लेबनान|Lebanon
Lesotho|Lesoto|Lesotho|Lesotho|Lesoto|ليسوتو|莱索托|लेसोथो|Lesotho
Liberia|Liberia|Liberia|Liberia|Libéria|ليبيريا|利比里亚|लाइबेरिया|Liberia
Libya|Libia|Libye|Libia|Líbia|ليبيا|利比亚|लीबिया|Libya
Liechtenstein|Liechtenstein|Liechtenstein|Liechtenstein|Liechtenstein|ليختنشتاين|列支敦士登|लिक्टेंस्टाइन|Liechtenstein
Lithuania|Lituania|Lituanie|Lituania|Lituânia|ليتوانيا|立陶宛|लिथुआनिया|Lithuania
Luxembourg|Luxemburgo|Luxembourg|Lussemburgo|Luxemburgo|لوكسمبورغ|卢森堡|लक्ज़मबर्ग|Luxembourg
Madagascar|Madagascar|Madagascar|Madagascar|Madagascar|مدغشقر|马达加斯加|मेडागास्कर|Madagascar
Malawi|Malaui|Malawi|Malawi|Malaui|مالاوي|马拉维|मलावी|Malawi
Malaysia|Malasia|Malaisie|Malesia|Malásia|ماليزيا|马来西亚|मलेशिया|Malaysia
Maldives|Maldivas|Maldives|Maldive|Maldivas|جزر المالديف|马尔代夫|मालदीव|Maldives
Mali|Malí|Mali|Mali|Mali|مالي|马里|माली|Mali
Malta|Malta|Malte|Malta|Malta|مالطا|马耳他|माल्टा|Malta
Marshall Islands|Islas Marshall|Îles Marshall|Isole Marshall|Ilhas Marshall|جزر مارشال|马绍尔群岛|मार्शल द्वीपसमूह|Kapuluang Marshall
Mauritania|Mauritania|Mauritanie|Mauritania|Mauritânia|موريتانيا|毛里塔尼亚|मॉरिटानिया|Mauritania
Mauritius|Mauricio|Maurice|Mauritius|Maurício|موريشيوس|毛里求斯|मॉरिशस|Mauritius
Mexico|México|Mexique|Messico|México|المكسيك|墨西哥|मेक्सिको|Mexico
Micronesia|Micronesia|Micronésie|Micronesia|Micronésia|ميكرونيزيا|密克罗尼西亚|माइक्रोनेशिया|Micronesia
Moldova|Moldavia|Moldavie|Moldavia|Moldávia|مولدوفا|摩尔多瓦|मोल्दोवा|Moldova
Monaco|Mónaco|Monaco|Monaco|Mônaco|موناكو|摩纳哥|मोनाको|Monaco
Mongolia|Mongolia|Mongolie|Mongolia|Mongólia|منغوليا|蒙古|मंगोलिया|Mongolia
Montenegro|Montenegro|Monténégro|Montenegro|Montenegro|الجبل الأسود|黑山|मोंटेनेग्रो|Montenegro
Morocco|Marruecos|Maroc|Marocco|Marrocos|المغرب|摩洛哥|मोरक्को|Morocco
Mozambique|Mozambique|Mozambique|Mozambico|Moçambique|موزمبيق|莫桑比克|मोज़ाम्बिक|Mozambique
Myanmar (Burma)|Myanmar (Birmania)|Myanmar (Birmanie)|Myanmar (Birmania)|Mianmar (Birmânia)|ميانمار (بورما)|缅甸|म्यांमार (बर्मा)|Myanmar (Burma)
Namibia|Namibia|Namibie|Namibia|Namíbia|ناميبيا|纳米比亚|नामीबिया|Namibia
Nauru|Nauru|Nauru|Nauru|Nauru|ناورو|瑙鲁|नाउरू|Nauru
Nepal|Nepal|Népal|Nepal|Nepal|نيبال|尼泊尔|नेपाल|Nepal
Netherlands|Países Bajos|Pays-Bas|Paesi Bassi|Países Baixos|هولندا|荷兰|नीदरलैंड|Netherlands
New Zealand|Nueva Zelanda|Nouvelle-Zélande|Nuova Zelanda|Nova Zelândia|نيوزيلندا|新西兰|न्यूज़ीलैंड|New Zealand
Nicaragua|Nicaragua|Nicaragua|Nicaragua|Nicarágua|نيكاراغوا|尼加拉瓜|निकारागुआ|Nicaragua
Niger|Níger|Niger|Niger|Níger|النيجر|尼日尔|नाइजर|Niger
Nigeria|Nigeria|Nigeria|Nigeria|Nigéria|نيجيريا|尼日利亚|नाइजीरिया|Nigeria
North Korea|Corea del Norte|Corée du Nord|Corea del Nord|Coreia do Norte|كوريا الشمالية|朝鲜|उत्तर कोरिया|Hilagang Korea
North Macedonia|Macedonia del Norte|Macédoine du Nord|Macedonia del Nord|Macedônia do Norte|مقدونيا الشمالية|北马其顿|उत्तर मैसेडोनिया|Hilagang Macedonia
Norway|Noruega|Norvège|Norvegia|Noruega|النرويج|挪威|नॉर्वे|Norway
Oman|Omán|Oman|Oman|Omã|عُمان|阿曼|ओमान|Oman
Pakistan|Pakistán|Pakistan|Pakistan|Paquistão|باكستان|巴基斯坦|पाकिस्तान|Pakistan
Palau|Palaos|Palaos|Palau|Palau|بالاو|帕劳|पलाऊ|Palau
Palestine|Palestina|Palestine|Palestina|Palestina|فلسطين|巴勒斯坦|फ़िलिस्तीन|Palestine
Panama|Panamá|Panama|Panama|Panamá|بنما|巴拿马|पनामा|Panama
Papua New Guinea|Papúa Nueva Guinea|Papouasie-Nouvelle-Guinée|Papua Nuova Guinea|Papua-Nova Guiné|بابوا غينيا الجديدة|巴布亚新几内亚|पापुआ न्यू गिनी|Papua New Guinea
Paraguay|Paraguay|Paraguay|Paraguay|Paraguai|باراغواي|巴拉圭|परागुआय|Paraguay
Peru|Perú|Pérou|Perù|Peru|بيرو|秘鲁|पेरू|Peru
Philippines|Filipinas|Philippines|Filippine|Filipinas|الفلبين|菲律宾|फ़िलीपींस|Pilipinas
Poland|Polonia|Pologne|Polonia|Polônia|بولندا|波兰|पोलैंड|Poland
Portugal|Portugal|Portugal|Portogallo|Portugal|البرتغال|葡萄牙|पुर्तगाल|Portugal
Qatar|Catar|Qatar|Qatar|Catar|قطر|卡塔尔|क़तर|Qatar
Romania|Rumanía|Roumanie|Romania|Romênia|رومانيا|罗马尼亚|रोमानिया|Romania
Russia|Rusia|Russie|Russia|Rússia|روسيا|俄罗斯|रूस|Russia
Rwanda|Ruanda|Rwanda|Ruanda|Ruanda|رواندا|卢旺达|रवांडा|Rwanda
Saint Kitts and Nevis|San Cristóbal y Nieves|Saint-Christophe-et-Niévès|Saint Kitts e Nevis|São Cristóvão e Névis|سانت كيتس ونيفيس|圣基茨和尼维斯|सेंट किट्स और नेविस|Saint Kitts at Nevis
Saint Lucia|Santa Lucía|Sainte-Lucie|Santa Lucia|Santa Lúcia|سانت لوسيا|圣卢西亚|सेंट लूसिया|Saint Lucia
Saint Vincent and the Grenadines|San Vicente y las Granadinas|Saint-Vincent-et-les-Grenadines|Saint Vincent e Grenadine|São Vicente e Granadinas|سانت فينسنت والغرينادين|圣文森特和格林纳丁斯|सेंट विंसेंट और ग्रेनेडाइंस|Saint Vincent at ang Grenadines
Samoa|Samoa|Samoa|Samoa|Samoa|ساموا|萨摩亚|समोआ|Samoa
San Marino|San Marino|Saint-Marin|San Marino|San Marino|سان مارينو|圣马力诺|सैन मारिनो|San Marino
Sao Tome and Principe|Santo Tomé y Príncipe|Sao Tomé-et-Principe|São Tomé e Príncipe|São Tomé e Príncipe|ساو تومي وبرينسيبي|圣多美和普林西比|साओ टोमे और प्रिंसिपे|Sao Tome at Principe
Saudi Arabia|Arabia Saudí|Arabie saoudite|Arabia Saudita|Arábia Saudita|المملكة العربية السعودية|沙特阿拉伯|सऊदी अरब|Saudi Arabia
Senegal|Senegal|Sénégal|Senegal|Senegal|السنغال|塞内加尔|सेनेगल|Senegal
Serbia|Serbia|Serbie|Serbia|Sérvia|صربيا|塞尔维亚|सर्बिया|Serbia
Seychelles|Seychelles|Seychelles|Seychelles|Seicheles|سيشل|塞舌尔|सेशेल्स|Seychelles
Sierra Leone|Sierra Leona|Sierra Leone|Sierra Leone|Serra Leoa|سيراليون|塞拉利昂|सिएरा लियोन|Sierra Leone
Singapore|Singapur|Singapour|Singapore|Singapura|سنغافورة|新加坡|सिंगापुर|Singapore
Slovakia|Eslovaquia|Slovaquie|Slovacchia|Eslováquia|سلوفاكيا|斯洛伐克|स्लोवाकिया|Slovakia
Slovenia|Eslovenia|Slovénie|Slovenia|Eslovênia|سلوفينيا|斯洛文尼亚|स्लोवेनिया|Slovenia
Solomon Islands|Islas Salomón|Îles Salomon|Isole Salomone|Ilhas Salomão|جزر سليمان|所罗门群岛|सोलोमन द्वीपसमूह|Kapuluang Solomon
Somalia|Somalia|Somalie|Somalia|Somália|الصومال|索马里|सोमालिया|Somalia
South Africa|Sudáfrica|Afrique du Sud|Sudafrica|África do Sul|جنوب أفريقيا|南非|दक्षिण अफ़्रीका|Timog Aprika
South Korea|Corea del Sur|Corée du Sud|Corea del Sud|Coreia do Sul|كوريا الجنوبية|韩国|दक्षिण कोरिया|Timog Korea
South Sudan|Sudán del Sur|Soudan du Sud|Sudan del Sud|Sudão do Sul|جنوب السودان|南苏丹|दक्षिण सूडान|Timog Sudan
Spain|España|Espagne|Spagna|Espanha|إسبانيا|西班牙|स्पेन|Espanya
Sri Lanka|Sri Lanka|Sri Lanka|Sri Lanka|Sri Lanka|سريلانكا|斯里兰卡|श्रीलंका|Sri Lanka
Sudan|Sudán|Soudan|Sudan|Sudão|السودان|苏丹|सूडान|Sudan
Suriname|Surinam|Suriname|Suriname|Suriname|سورينام|苏里南|सूरीनाम|Suriname
Sweden|Suecia|Suède|Svezia|Suécia|السويد|瑞典|स्वीडन|Sweden
Switzerland|Suiza|Suisse|Svizzera|Suíça|سويسرا|瑞士|स्विट्ज़रलैंड|Switzerland
Syria|Siria|Syrie|Siria|Síria|سوريا|叙利亚|सीरिया|Syria
Tajikistan|Tayikistán|Tadjikistan|Tagikistan|Tadjiquistão|طاجيكستان|塔吉克斯坦|ताजिकिस्तान|Tajikistan
Tanzania|Tanzania|Tanzanie|Tanzania|Tanzânia|تنزانيا|坦桑尼亚|तंज़ानिया|Tanzania
Thailand|Tailandia|Thaïlande|Thailandia|Tailândia|تايلاند|泰国|थाईलैंड|Thailand
Timor-Leste|Timor-Leste|Timor-Leste|Timor Est|Timor-Leste|تيمور الشرقية|东帝汶|तिमोर-लेस्ते|Timor-Leste
Togo|Togo|Togo|Togo|Togo|توغو|多哥|टोगो|Togo
Tonga|Tonga|Tonga|Tonga|Tonga|تونغا|汤加|टोंगा|Tonga
Trinidad and Tobago|Trinidad y Tobago|Trinité-et-Tobago|Trinidad e Tobago|Trinidad e Tobago|ترينيداد وتوباغو|特立尼达和多巴哥|त्रिनिदाद और टोबैगो|Trinidad at Tobago
Tunisia|Túnez|Tunisie|Tunisia|Tunísia|تونس|突尼斯|ट्यूनीशिया|Tunisia
Turkey|Turquía|Turquie|Turchia|Turquia|تركيا|土耳其|तुर्की|Turkey
Turkmenistan|Turkmenistán|Turkménistan|Turkmenistan|Turcomenistão|تركمانستان|土库曼斯坦|तुर्कमेनिस्तान|Turkmenistan
Tuvalu|Tuvalu|Tuvalu|Tuvalu|Tuvalu|توفالو|图瓦卢|तुवालु|Tuvalu
Uganda|Uganda|Ouganda|Uganda|Uganda|أوغندا|乌干达|युगांडा|Uganda
Ukraine|Ucrania|Ukraine|Ucraina|Ucrânia|أوكرانيا|乌克兰|यूक्रेन|Ukraine
United Arab Emirates|Emiratos Árabes Unidos|Émirats arabes unis|Emirati Arabi Uniti|Emirados Árabes Unidos|الإمارات العربية المتحدة|阿拉伯联合酋长国|संयुक्त अरब अमीरात|United Arab Emirates
United Kingdom|Reino Unido|Royaume-Uni|Regno Unito|Reino Unido|المملكة المتحدة|英国|यूनाइटेड किंगडम|United Kingdom
United States|Estados Unidos|États-Unis|Stati Uniti|Estados Unidos|الولايات المتحدة|美国|संयुक्त राज्य अमेरिका|Estados Unidos
Uruguay|Uruguay|Uruguay|Uruguay|Uruguai|أوروغواي|乌拉圭|उरुग्वे|Uruguay
Uzbekistan|Uzbekistán|Ouzbékistan|Uzbekistan|Uzbequistão|أوزبكستان|乌兹别克斯坦|उज़्बेकिस्तान|Uzbekistan
Vanuatu|Vanuatu|Vanuatu|Vanuatu|Vanuatu|فانواتو|瓦努阿图|वानुआतु|Vanuatu
Vatican City|Ciudad del Vaticano|Cité du Vatican|Città del Vaticano|Cidade do Vaticano|الفاتيكان|梵蒂冈|वेटिकन सिटी|Vatican City
Venezuela|Venezuela|Venezuela|Venezuela|Venezuela|فنزويلا|委内瑞拉|वेनेज़ुएला|Venezuela
Vietnam|Vietnam|Viêt Nam|Vietnam|Vietnã|فيتنام|越南|वियतनाम|Vietnam
Yemen|Yemen|Yémen|Yemen|Iêmen|اليمن|也门|यमन|Yemen
Zambia|Zambia|Zambie|Zambia|Zâmbia|زامبيا|赞比亚|ज़ाम्बिया|Zambia
Zimbabwe|Zimbabue|Zimbabwe|Zimbabwe|Zimbábue|زيمبابوي|津巴布韦|ज़िम्बाब्वे|Zimbabwe
""")
