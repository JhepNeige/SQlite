import { chromium } from "playwright";
import { spawn } from "child_process";



// URL à tester
const URL = "https://www.calendriergratuit.fr/calendrier-scolaire-2025.htm";

// 1️⃣ Fonction pour rendre la page et créer un snapshot “humain”
async function renderPage(url) {
	const browser = await chromium.launch({
	  headless: true,
	  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
	});
  const page = await browser.newPage();

  const response = await page.goto(url, {
    waitUntil: "networkidle",
    timeout: 20000,
  });

  const snapshot = "Metadata:\n"+JSON.stringify({
    url,
    finalUrl: page.url(),
    httpStatus: response?.status() ?? null,
    title: await page.title(),
  //  visibleText: ,
    numImages: await page.locator("img").count(),
    numLinks: await page.locator("a").count(),
    hasLoginForm: (await page.locator("input[type=password]").count()) > 0,
    timestamp: new Date().toISOString(),
  }, null, 2) + "\nvisibleText:\n" + (
      await page.evaluate(() => document.body.innerText)
    ).slice(0, 6000);

  await browser.close();
  return snapshot;
}

// 2️⃣ Fonction pour envoyer le snapshot à llama-cli
function askLlama(snapshot) {
  return new Promise((resolve, reject) => {
    // Construire le prompt clair pour classification
    const prompt = `
Tu es un humain évaluant une page web.
Classe la page EXACTEMENT dans UNE des catégories suivantes :
- OK
- Non OK sans aucun doute
- Probablement OK
- Probablement non OK

Voici le snapshot JSON de la page :
${snapshot}

Réponse :
`;

    // Lancer llama-cli avec prompt unique
    // Remplace le chemin du binaire selon ton système
    const llama = spawn("llama-cli", [
      "-m", "C:\\Users\\A513894\\OneDrive - Volvo Group\\Downloads\\mistral-7b-v0.1.Q4_K_M.gguf",
      "-p", prompt,
      "-n", "64",         // limite tokens pour éviter délire
      "--temp", "0.2"     // génération déterministe
    ]);

    let out = "";
    llama.stdout.on("data", (data) => (out += data.toString()));
    llama.stderr.on("data", (data) => console.error(data.toString()));
    llama.on("close", () => resolve(out.trim()));
  });
}

// 3️⃣ Pipeline complet
async function run() {
  console.log("Rendu de la page :", URL);
  const snapshot = await renderPage(URL);

  console.log("Snapshot généré. Envoi à LLaMA...");
  const verdict = await askLlama(snapshot);

  console.log("\n=== VERDICT IA ===");
  console.log(verdict);
}

run();
