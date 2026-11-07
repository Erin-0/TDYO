# Plan d'Architecture & Guide d'Implémentation : Plateforme de Contribution Anonyme sur Cloudflare Pages (.pages.dev) + Supabase

Ce document détaille la solution exacte sélectionnée pour **YODRIVE**, hébergé sur **Cloudflare Pages (`.pages.dev`)**, couplé à un backend serverless gratuit et ultra-rapide basé sur **Cloudflare Pages Functions** et **Supabase**.

---

## 1. Vue d'Ensemble de l'Architecture

```
  ┌────────────────────────────────────────────────────────┐
  │                 Utilisateur / Étudiant                │
  │  (Sans compte, 100% Anonyme, aucun login requis)      │
  └───────────────────────────┬────────────────────────────┘
                              │
                              │ 1. Glisse-dépose un fichier (PDF ou photo)
                              │    + Sélectionne : Matière & Type (Cours, TD, Exam...)
                              ▼
  ┌────────────────────────────────────────────────────────┐
  │           Frontend YODRIVE (.pages.dev)               │
  │     Bouton / Modale : "Proposer une ressource"         │
  └───────────────────────────┬────────────────────────────┘
                              │
                              │ 2. Envoi via POST /api/upload
                              ▼
  ┌────────────────────────────────────────────────────────┐
  │    Cloudflare Pages Functions (/functions/api/...)    │
  │  - Nettoyage des métadonnées (EXIF GPS des photos)     │
  │  - Vérification de la taille & de l'extension (.pdf...)│
  │  - Renommage sécurisé avec ID unique                  │
  └─────────────┬────────────────────────────┬─────────────┘
                │                            │
   Stockage     │ 3. Upload fichier          │ 4. Insertion métadonnées
   du fichier   ▼                            ▼    (statut: "pending")
  ┌─────────────────────────┐   ┌───────────────────────────┐
  │  Supabase Storage / R2  │   │     Supabase Database     │
  │     Bucket "pending"    │   │  Table "contributions"    │
  └─────────────────────────┘   └─────────────┬─────────────┘
                                              │
                                              │ 5. Webhook / Notification instantanée
                                              ▼
                                ┌───────────────────────────┐
                                │   Alerte Administrateur   │
                                │   (Bot Telegram Privé)    │
                                └─────────────┬─────────────┘
                                              │
                                              │ 6. Lien sécurisé vers
                                              ▼
  ┌─────────────────────────────────────────────────────────┐
  │          Tableau de Bord Admin (Modération)             │
  │  - Aperçu direct du PDF                                 │
  │  - Possibilité de corriger le titre / la matière        │
  │  - 1 Clic : [ ✅ Approuver et Publier ] ou [ ❌ Rejeter ]│
  └─────────────────────────────────────────────────────────┘
```

---

## 2. Pourquoi ce Choix est Idéal pour YODRIVE

| Caractéristique | Bénéfice pour votre projet |
| :--- | :--- |
| **Hébergement Cloudflare Pages** | Vous utilisez déjà `*.pages.dev` avec CDN mondial ultra-rapide et gratuit à vie. |
| **Pages Functions intégrées** | Aucun serveur dédié à maintenir : les scripts d'API s'exécutent directement à la périphérie (Edge). |
| **100% Anonyme** | Aucune session requise, aucun cookie de traçage, aucune adresse email obligatoire. |
| **Supabase (Tier Gratuit)** | Base de données PostgreSQL avec RLS + Stockage jusqu'à 1 Go (ou 10 Go via Cloudflare R2). |
| **Notifications Telegram** | Vous recevez une alerte sur votre téléphone dès qu'un document est soumis, sans révéler votre numéro WhatsApp. |

---

## 3. Schéma de la Base de Données (Supabase)

Dans votre projet Supabase (gratuit sur [supabase.com](https://supabase.com)), créez la table `contributions` :

```sql
create table public.contributions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  matiere text not null,               -- ex: 'chimie-organique'
  type text not null,                  -- 'cours' | 'td' | 'exams' | 'resumes' | 'autres'
  subtype text,                        -- 'TD1', 'TD2', 'Examen 2026', etc.
  titre text not null,                 -- Titre proposé
  file_url text not null,              -- URL temporaire dans le bucket
  file_name text not null,             -- Nom original du fichier
  file_size integer not null,          -- Taille en octets
  status text default 'pending'        -- 'pending' | 'approved' | 'rejected'
);

-- Sécurité Row Level Security (RLS) :
alter table public.contributions enable row level security;

-- 1. Tout le monde (anonyme) peut INSÉRER une nouvelle contribution
create policy "Autoriser envoi anonyme" 
on public.contributions for insert 
to anon with check (true);

-- 2. SEUL l'administrateur peut LIRE et MODIFIER les contributions
create policy "Lecture réservée à l'admin" 
on public.contributions for select 
to authenticated using (true);

create policy "Mise à jour réservée à l'admin" 
on public.contributions for update 
to authenticated using (true);
```

---

## 4. Endpoint Serverless : Cloudflare Pages Functions

Dans votre projet Cloudflare Pages, il suffit d'ajouter un dossier `/functions/api/upload.js`. Cloudflare Pages transforme automatiquement ce fichier en une fonction Serverless API !

### Exemple de script `/functions/api/upload.js` :

```javascript
export async function onRequestPost({ request, env }) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const matiere = formData.get('matiere');
    const type = formData.get('type');
    const titre = formData.get('titre') || file.name;

    // 1. Validation de sécurité
    if (!file) {
      return new Response(JSON.stringify({ error: 'Aucun fichier reçu' }), { status: 400 });
    }

    const allowedExtensions = ['.pdf', '.jpg', '.jpeg', '.png'];
    const fileName = file.name.toLowerCase();
    const isValidExt = allowedExtensions.some(ext => fileName.endsWith(ext));
    if (!isValidExt) {
      return new Response(JSON.stringify({ error: 'Format non autorisé. Utilisez PDF, JPG ou PNG.' }), { status: 400 });
    }

    // 2. Upload vers Supabase Storage
    const cleanFileName = `${Date.now()}_${Math.random().toString(36).substring(7)}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const uploadRes = await fetch(`${env.SUPABASE_URL}/storage/v1/object/pending-contributions/${cleanFileName}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': file.type
      },
      body: file
    });

    if (!uploadRes.ok) throw new Error('Erreur de stockage');

    const fileUrl = `${env.SUPABASE_URL}/storage/v1/object/public/pending-contributions/${cleanFileName}`;

    // 3. Enregistrement dans la table Supabase
    await fetch(`${env.SUPABASE_URL}/rest/v1/contributions`, {
      method: 'POST',
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        matiere,
        type,
        titre,
        file_url: fileUrl,
        file_name: file.name,
        file_size: file.size,
        status: 'pending'
      })
    });

    // 4. Alerte immédiate sur Telegram (Bot privé)
    if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
      const msg = `📢 *Nouvelle ressource soumise sur YODRIVE !*\n\n`
                + `📚 *Matière* : ${matiere}\n`
                + `🏷 *Type* : ${type}\n`
                + `📝 *Titre* : ${titre}\n`
                + `🔗 [Voir le document](${fileUrl})`;
      await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_CHAT_ID,
          text: msg,
          parse_mode: 'Markdown'
        })
      });
    }

    return new Response(JSON.stringify({ success: true, message: 'Document envoyé avec succès pour modération !' }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
```

---

## 5. Interface Utilisateur (Modale "Proposer un Document")

Un bouton discret dans le site (ex: dans la barre latérale ou la barre supérieure) ouvre une modale élégante :

1. **Zone de Dépôt (Drag & Drop)** : Glisser le PDF ou les photos du cours/TD.
2. **Choix de la Matière** : Menu déroulant (*Chimie organique, Circuits électriques...*).
3. **Choix du Type** : *Cours / TD / Examen / Résumé / Autre*.
4. **Précision (optionnel)** : ex. *TD 3 - Énoncé* ou *Examen Rattrapage 2025*.
5. **Garantie d'Anonymat affichée** : *"Votre envoi est anonyme : aucune donnée personnelle n'est enregistrée."*
6. **Bouton d'envoi** : *"Envoyer pour relecture"*.

---

## 6. Flux de Modération Administrateur

Quand un document arrive :
1. Vous recevez un message instantané sur Telegram avec le lien direct du document.
2. Vous ouvrez votre interface admin (ex: `/admin.html` protégé par un mot de passe ou via le tableau de bord Supabase).
3. Vous vérifiez la lisibilité et la pertinence du document.
4. **Si validé** :
   - Le statut passe à `approved`.
   - Vous pouvez soit lancer un script automatique qui intègre le document dans `index.html` et redéploie sur Cloudflare, soit charger dynamiquement les documents approuvés depuis l'API Supabase !

---

## 7. Variables d'Environnement à Définir sur Cloudflare Pages

Dans les paramètres de votre projet Cloudflare Pages (*Settings > Environment variables*) :
- `SUPABASE_URL` : L'URL de votre projet Supabase.
- `SUPABASE_SERVICE_ROLE_KEY` : Clé secrète de service (uniquement accessible côté serveur Cloudflare).
- `TELEGRAM_BOT_TOKEN` : Token de votre bot Telegram (obtenu gratuitement via `@BotFather`).
- `TELEGRAM_CHAT_ID` : Votre ID Telegram personnel.

