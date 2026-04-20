import { processTranscript } from "./pipeline.js";

const sample = 
`
[00:00-00:04] Agent: Good morning sir, Lakshmi here from Pearl City Properties
[00:04-00:08] Lead: yes Lakshmi, sollunga
[00:08-00:18] Agent: Sir, naanga Siruseri-la oru pudhu 2BHK launch pannirukkom, starting 42 lakhs. Budget-la fit aagumaa?
[00:18-00:28] Lead: 2BHK-ah? rate okay thaan. But location konjam dooram. I work in Guindy actually
[00:28-00:38] Agent: Sir, Siruseri-la IT corridor close-a iruku. OMR via bus or car, 45 min to Guindy. Future-la metro varum
[00:38-00:48] Lead: hmm okay. Sqft evlo iruku? EMI approximately how much?
[00:48-00:58] Agent: Sir, 850 sqft carpet, 1010 built-up. 42L-ku 20% down, 20-year loan, monthly EMI around 28K
[00:58-01:10] Lead: okay. Ipo just exploring thaan. Marriage-ku later plan. Probably 6 months-la think pannuven
[01:10-01:20] Agent: Understood sir. I'll share brochure on WhatsApp. Can I follow up in 2 weeks?
[01:20-01:26] Lead: yes, send details. 2 weeks call pannunga
[01:26-01:32] Agent: Thank you sir, details vanthu paathunga. Vanakkam
`;

async function run() {
  const result = await processTranscript(sample);
  console.log(result);
}

run();