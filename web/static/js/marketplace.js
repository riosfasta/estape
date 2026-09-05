export function createMarketplace({ api, state, shell, app, esc, icons, uploadResizedImage, openEmbeddedCheckout, cropMarketplaceImage, imagePreviewURL }) {
  const $ = (s) => document.querySelector(s);
  const money = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(cents || 0) / 100);
  const date = (value) => value ? new Date(value).toLocaleString() : "—";
  const cents = (value) => { if (!/^\d+(\.\d{1,2})?$/.test(String(value))) throw new Error("Enter a positive amount with at most two decimals"); return Math.round(Number(value) * 100); };
  const chips = (skills) => `<div class="market-skills">${(skills || []).map(s => `<span>${esc(s)}</span>`).join("")}</div>`;
  const badge = (status) => `<span class="market-badge">${esc(String(status || "").replaceAll("_", " "))}</span>`;
  const empty = (text) => `<p class="market-empty">${esc(text)}</p>`;
  const photo = (p) => p.photo ? `<img class="market-avatar" src="${esc(p.photo)}" alt="${esc(p.name)}" loading="lazy">` : `<span class="market-avatar market-initial">${esc((p.name || "?")[0])}</span>`;
  const skillsValue = (form) => [...form.querySelectorAll('[name="skill"]:checked')].map(x => x.value).concat(String(new FormData(form).get("custom_skills") || "").split(","));
  let connectsPolicy = { amount: 100, period: "weekly" };
  const notice = () => `<p class="market-notice">Freelancing is free: no monthly subscription. Receive ${connectsPolicy.amount} Connects ${connectsPolicy.period === "monthly" ? "on the first of each month" : "every Monday"} at 00:00 UTC; each bid uses 10. Unused Connects do not roll over. Premium subscriptions apply to bug reporting only.</p>`;
  const post = (url, body = {}) => api(url, { method: "POST", body: JSON.stringify(body) });
  let skillCatalog = [];
  const countryCodes = "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" ");
  const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
  const countries = countryCodes.map(code => ({ code, name: regionNames.of(code) })).sort((a, b) => a.name.localeCompare(b.name));
  const countryOptions = (value = "") => `<option value="">Choose country</option>${countries.map(c => `<option value="${c.code}" ${c.code === value ? "selected" : ""}>${esc(c.name)}</option>`).join("")}`;
  function page(title, html) {
    const content = `<div class="marketplace"><div id="marketMessage" role="status" aria-live="polite"></div>${html}</div>`;
    if (state.me) shell(title, content);
    else app.innerHTML = `<header class="market-public-nav"><a href="/" class="brand">Home</a><nav><a href="/freelancers">Find freelancers</a><a href="/find-jobs">Find jobs</a><a href="/login">Log in</a><a class="btn primary" href="/register">Join for free</a></nav></header><main class="market-public">${content}</main>`;
    icons();
  }
  function message(text, error = false) {
    const mount = $("#marketMessage"); if (mount) { mount.textContent = text; mount.className = error ? "market-error" : "market-success"; mount.scrollIntoView({ block: "nearest" }); }
  }
  function bindForm(selector, handler) {
    $(selector)?.addEventListener("submit", async e => {
      e.preventDefault(); const form = e.currentTarget; const button = form.querySelector('[type="submit"]');
      if (button?.disabled) return;
      if (button) button.disabled = true;
      try { await handler(form); } catch (error) { message(error.message, true); } finally { if (button) button.disabled = false; }
    });
  }
  function bindButtons(selector, handler) {
    document.querySelectorAll(selector).forEach(button => button.addEventListener("click", async () => {
      if (button.disabled) return; button.disabled = true;
      try { await handler(button); } catch (error) { message(error.message, true); } finally { button.disabled = false; }
    }));
  }
  const heading = (kicker, title, text, actions = "") => `<header class="market-heading"><div><p class="market-kicker">${esc(kicker)}</p><h1>${esc(title)}</h1><p class="muted">${esc(text)}</p></div><div class="toolbar">${actions}</div></header>`;
  const availabilityLabel = p => p.active_jobs > 0 || p.availability === "running_project" ? "In a running project" : p.availability === "busy" ? "Busy" : p.available === false ? "Busy" : "Available now";
  const portfolio = p => (p.portfolio_photos?.length || p.youtube_urls?.length) ? `<section class="panel"><h2>Project portfolio</h2><div class="market-portfolio">${(p.portfolio_photos || []).map(url => `<a href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(url)}" alt="Project work sample" loading="lazy"></a>`).join("")}</div><div class="toolbar">${(p.youtube_urls || []).map((url, i) => `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener">Watch project video ${i + 1} on YouTube</a>`).join("")}</div></section>` : "";
  const stats = (p) => `<div class="market-stats"><div><strong>${p.rating_count ? Number(p.rating).toFixed(1) + " / 5" : "New"}</strong><span>${Number(p.rating_count || 0)} reviews</span></div><div><strong>${Number(p.finished_jobs || 0)}</strong><span>Finished jobs</span></div><div><strong>${Number(p.published_jobs || 0)}</strong><span>Published jobs</span></div><div><strong>${availabilityLabel(p)}</strong><span>Current availability</span></div></div>`;
  const jobCards = (jobs) => jobs.length ? `<div class="market-job-list">${jobs.map(j => `<article class="panel market-job"><div><a href="/marketplace/jobs/${esc(j.id)}"><h3>${esc(j.title)}</h3></a><p>${esc(j.description?.slice(0, 220) || "")}</p>${chips(j.skills)}<small class="muted">${esc(j.owner_name || "Employer")} · ${esc(date(j.created_at))}</small></div><aside><strong>${money(j.price || j.budget)}</strong><span>Fixed price · USD</span>${badge(j.status)}<a class="btn" href="/marketplace/jobs/${esc(j.id)}">View job</a></aside></article>`).join("")}</div>` : empty("No jobs here yet.");
  function skillPicker(selected = []) {
    return `<fieldset class="market-skill-picker"><legend>Skills (choose up to 30, including custom skills)</legend><div>${skillCatalog.map(skill => `<label><input type="checkbox" name="skill" value="${esc(skill)}" ${selected.includes(skill) ? "checked" : ""}>${esc(skill)}</label>`).join("")}</div></fieldset><label class="field">Custom skills, separated by commas<input name="custom_skills" maxlength="1000" value="${esc(selected.filter(s => !skillCatalog.includes(s)).join(", "))}" placeholder="Add a specialty not listed above"></label>`;
  }
  function shareProfile(p, published = p.public) {
    if (!published) return '<section class="panel"><h2>Share your profile</h2><p class="muted">Every user can share a public profile. Complete your profile, enable public visibility and agree to public display below, then save to activate your link.</p></section>';
    const url = new URL('/freelancers/' + encodeURIComponent(p.id), location.origin).href;
    return `<section class="panel"><h2>Share your profile</h2><p class="muted">Anyone with this link can view your public profile without logging in or registering.</p><div class="market-share"><label class="field">Public profile link<input id="marketShareURL" type="url" readonly value="${esc(url)}"></label><button class="btn primary" type="button" id="marketCopyProfile">Copy link</button><a class="btn" href="${esc(url)}" target="_blank" rel="noopener">View public profile</a></div></section>`;
  }
  function bindProfileShare() {
    $('#marketShareURL')?.addEventListener('click', e => e.currentTarget.select());
    bindButtons('#marketCopyProfile', async () => {
      const input = $('#marketShareURL');
      try {
        await navigator.clipboard.writeText(input.value);
        message('Public profile link copied. Anyone can open it without an account.');
      } catch {
        input.focus(); input.select();
        message('Select and copy the profile link above with Ctrl+C or your device?s Copy action.');
      }
    });
  }
  async function dashboard() {
    const data = await api("/api/marketplace/me"); const p = data.profile;
    connectsPolicy = data.connects_policy || connectsPolicy;
    page("My profile", `${heading("YOUR MARKETPLACE PROFILE", "Build your next opportunity", "Hire talent, find work, and grow your reputation.", `<a class="btn" href="/marketplace/jobs">My jobs & offers</a><a class="btn primary" href="/find-jobs">Find work</a>`)}${notice()}
      <section class="panel market-profile-summary"><div class="market-person">${photo(p)}<div><h2>${esc(p.name)}</h2><p>${esc(p.title || "Add your professional title")}</p><span class="muted">${esc(p.location || "Add location")}${p.country ? ", " + esc(regionNames.of(p.country)) : ""}</span></div>${badge(p.public ? "Public profile" : "Private draft")}</div>${stats(p)}${chips(p.skills)}<p class="market-bio">${esc(p.bio)}</p></section>
      ${shareProfile(p)}${portfolio(p)}
      <div class="market-columns"><section class="panel"><h2>Profile details</h2><p class="muted">Complete these details and submit an ID before applying or hiring. Public profiles are visible to visitors.</p>
      <form id="marketProfile" class="market-form"><div class="grid-2"><label class="field">Display name<input name="name" value="${esc(p.name)}" maxlength="100" required></label><label class="field">Professional title<input name="title" value="${esc(p.title)}" maxlength="120" required placeholder="WordPress developer & designer"></label><label class="field">Country<select name="country" required>${countryOptions(p.country)}</select></label><label class="field">City / region<input name="location" value="${esc(p.location)}" maxlength="120" required></label></div>
      <label class="field">About you<textarea name="bio" rows="5" minlength="30" maxlength="5000" required placeholder="Tell clients what you do and the results you can deliver.">${esc(p.bio)}</textarea></label>
      <label class="field">Availability<select name="availability"><option value="available" ${!p.availability || p.availability === "available" ? "selected" : ""}>Available now</option><option value="busy" ${p.availability === "busy" ? "selected" : ""}>Busy</option><option value="running_project" ${p.availability === "running_project" ? "selected" : ""}>In a running project</option></select></label><p class="muted">An active Bugmega job always shows you as in a running project until it finishes.</p>
      <label class="field">Profile photo (max 500 KB)<input type="file" name="photo_file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"></label><img id="marketPhotoPreview" class="market-photo-preview" alt="Profile photo preview" ${p.photo ? `src="${esc(p.photo)}"` : "hidden"}><p class="muted">Choose an image, crop it, and confirm the preview before saving.</p>
      <fieldset class="market-skill-picker"><legend>Project proof / portfolio</legend><p>Up to 12 project photos and 6 YouTube videos. These are public when you publish your profile. Only share work you have permission to display.</p><label class="field">Add project photos (max 500 KB each)<input type="file" id="marketPortfolioFiles" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" multiple></label><section id="marketPortfolioPreview" class="market-portfolio"></section><label class="field">YouTube video URLs (one per line)<textarea name="youtube_urls" rows="3" placeholder="https://www.youtube.com/watch?v=...">${esc((p.youtube_urls || []).join("\n"))}</textarea></label></fieldset>${skillPicker(p.skills)}
      <label class="market-check"><input type="checkbox" name="public" ${p.public ? "checked" : ""}><span>Make my profile public and shareable (also listed in the freelancer directory)</span></label>
      <label class="market-check"><input type="checkbox" name="consent" ${p.public ? "checked" : ""}><span>I agree that the platform may display my profile photo, portfolio photos and YouTube links, display name, bio, skills, city/country, availability, job counts and reviews across its pages, including the homepage, directory and job pages. I have read the <a href="/marketplace/privacy" target="_blank" rel="noopener">marketplace privacy policy</a>. My ID image stays private.</span></label>
      <p class="muted">Uncheck “Publish my profile” and save to withdraw public-display consent and hide your profile. Existing contracts and payment records remain.</p><button type="submit" class="btn primary">Save profile</button></form></section>
      <aside><section class="panel"><h2>Your Connects</h2><div class="market-large">${p.connects}<small> available</small></div><p>${connectsPolicy.amount} Connects ${connectsPolicy.period}. 10 per bid. Invited offers cost none.</p><p class="muted">Resets ${esc(date(data.connects_reset_at))}. The balance, including manual grants, resets to the allowance. No rollover.</p></section>
      <section class="panel"><h2>Identity verification</h2>${badge(p.identity_status)}<p class="muted">Upload a readable government ID as JPG, JPEG, PNG or WebP, up to 500 KB. Only you and the platform owner can view it. Submission permits applying; an approved verification is required for withdrawal.</p>
      <form id="marketIdentity" class="market-form"><label class="field">ID card image<input type="file" name="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"></label><img id="marketIdentityPreview" class="market-id-preview" alt="Cropped ID preview (private)" hidden><p class="muted">Crop and review the ID preview before submitting. Keep all document edges and text visible.</p><label class="market-check"><input type="checkbox" name="consent" required><span>I acknowledge private identity processing for verification, fraud prevention and payout validation under the <a href="/marketplace/privacy" target="_blank" rel="noopener">privacy policy</a>.</span></label><button class="btn" type="submit">Submit ID for review</button></form>
      ${p.identity_status !== "not_submitted" ? `<div class="toolbar"><button class="btn" id="viewMyIdentity">View my ID</button><button class="btn" id="deleteMyIdentity">Remove ID</button></div>` : ""}</section>
      <section class="panel"><h2>Payments, clearly explained</h2><p>Keep 95% of each approved payment. The platform fee is 5%. Earnings unlock seven days after employer approval.</p><a class="btn" href="/wallet">Open wallet</a></section></aside></div>
      <h2>Recent jobs</h2>${jobCards(data.jobs.slice(0, 5))}`);
    bindProfileShare();
    const media = bindProfileMedia(p);
    bindForm("#marketProfile", async form => {
      const values = Object.fromEntries(new FormData(form)); let url = p.photo;
      if (values.photo_file?.size && !media.photo) throw new Error("Crop and confirm your profile photo first.");
      if (media.photo) { if (!media.photoURL) media.photoURL = (await uploadMedia(media.photo)).url; url = media.photoURL; }
      const portfolioPhotos = [];
      for (const item of media.portfolio) { if (!item.url) item.url = (await uploadMedia(item.file)).url; portfolioPhotos.push(item.url); }
      await api("/api/marketplace/profile", { method: "PUT", body: JSON.stringify({ name: values.name, title: values.title, bio: values.bio, country: values.country, location: values.location, skills: skillsValue(form), photo: url, availability: values.availability, portfolio_photos: portfolioPhotos, youtube_urls: String(values.youtube_urls || "").split(/\r?\n/).map(url => url.trim()).filter(Boolean), public: !!values.public, consent: !!values.consent }) });
      await dashboard(); message("Profile saved.");
    });
    bindForm("#marketIdentity", async form => { if (!media.identity) throw new Error("Crop and confirm the ID preview first."); const fd = new FormData(form); fd.set("file", media.identity); fd.set("consent", "true"); await api("/api/marketplace/identity", { method: "POST", body: fd }); await dashboard(); message("ID submitted for private review."); });
    bindButtons("#viewMyIdentity", () => showIdentity(p.id));
    bindButtons("#deleteMyIdentity", async () => { await api("/api/marketplace/identity", { method: "DELETE" }); await dashboard(); message("ID removed. Submit a new ID before applying or withdrawing."); });
  }
  async function uploadMedia(file) {
    const body = new FormData(); body.append("file", file);
    return api("/api/marketplace/media", { method: "POST", body });
  }
  function bindProfileMedia(profile) {
    const media = { photo: null, identity: null, portfolio: (profile.portfolio_photos || []).map(url => ({ url, preview: url })) };
    const bindCrop = (selector, purpose, previewID) => {
      $(selector)?.addEventListener("change", async event => {
        const input = event.target;
        if (!input.files[0]) return;
        try {
          const cropped = await cropMarketplaceImage(input.files[0], purpose);
          if (cropped) {
            media[purpose === "profile" ? "photo" : "identity"] = cropped;
            if (purpose === "profile") media.photoURL = "";
            const preview = $(previewID); preview.src = await imagePreviewURL(cropped); preview.hidden = false;
          }
        } catch (error) { message(error.message, true); }
        finally { input.value = ""; }
      });
    };
    bindCrop('#marketProfile [name="photo_file"]', "profile", "#marketPhotoPreview");
    bindCrop('#marketIdentity [name="file"]', "identity", "#marketIdentityPreview");
    function renderPhotos() {
      const mount = $("#marketPortfolioPreview"); if (!mount) return;
      mount.innerHTML = media.portfolio.map((item, index) => `<figure><img src="${esc(item.preview)}" alt="Project photo ${index + 1} preview"><button class="btn" type="button" data-remove-portfolio="${index}">Remove photo ${index + 1}</button></figure>`).join("");
      mount.querySelectorAll("[data-remove-portfolio]").forEach(button => { button.onclick = () => { media.portfolio.splice(Number(button.dataset.removePortfolio), 1); renderPhotos(); }; });
    }
    $("#marketPortfolioFiles")?.addEventListener("change", async event => {
      const input = event.target;
      try {
        if (media.portfolio.length + input.files.length > 12) throw new Error("You can add up to 12 project photos.");
        for (const file of Array.from(input.files)) {
          const cropped = await cropMarketplaceImage(file, "portfolio");
          if (cropped) { media.portfolio.push({ file: cropped, preview: await imagePreviewURL(cropped) }); renderPhotos(); }
        }
      } catch (error) { message(error.message, true); }
      finally { input.value = ""; }
    });
    renderPhotos();
    return media;
  }

  async function showIdentity(id) {
    const response = await fetch(`/api/marketplace/identity/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${state.access}` } });
    if (!response.ok) throw new Error("Unable to load private ID image");
    const url = URL.createObjectURL(await response.blob());
    const dialog = document.createElement("dialog"); dialog.className = "modal market-id-dialog";
    dialog.innerHTML = `<h2>Private identity document</h2><img alt="Private identity document"><button class="btn" type="button">Close</button>`;
    dialog.querySelector("img").src = url; document.body.append(dialog);
    dialog.addEventListener("close", () => { URL.revokeObjectURL(url); dialog.remove(); }, { once: true });
    dialog.querySelector("button").onclick = () => dialog.close(); dialog.showModal();
  }
  async function directory() {
    const params = new URLSearchParams(location.search); const data = await api(`/api/marketplace/freelancers?${params}`);
    page("Find freelancers", `${heading("TALENT, WITHOUT BORDERS", "Find the right person for your next project", "Explore independent professionals. Filter by expertise, reputation, availability and country.")}
      <form id="marketFilters" class="panel market-filters"><label class="field">Skill<input name="skill" value="${esc(params.get("skill") || "")}" list="marketSkillOptions" placeholder="Any skill, including custom"><datalist id="marketSkillOptions">${skillCatalog.map(s => `<option value="${esc(s)}">`).join("")}</datalist></label><label class="field">Country<select name="country">${countryOptions(params.get("country"))}</select></label><label class="field">Minimum rating<select name="rating">${["", "3", "4", "4.5", "5"].map(v => `<option value="${v}" ${params.get("rating") === v ? "selected" : ""}>${v ? v + "+ stars" : "Any rating"}</option>`).join("")}</select></label><label class="field">Availability<select name="availability">${[["", "Everyone"], ["available", "Available now"], ["busy", "Busy"], ["running_project", "In a running project"]].map(([value, label]) => `<option value="${value}" ${(params.get("availability") || (params.get("available") === "true" ? "available" : "")) === value ? "selected" : ""}>${label}</option>`).join("")}</select></label><button class="btn primary" type="submit">Search</button></form>
      <div class="market-talent-grid">${data.freelancers.map(p => `<article class="panel market-talent"><div class="market-person">${photo(p)}<div><h2><a href="/freelancers/${esc(p.id)}">${esc(p.name)}</a></h2><p>${esc(p.title)}</p></div></div><p class="muted">${esc(p.location)}, ${esc(regionNames.of(p.country))}</p><div class="toolbar">${badge(availabilityLabel(p))}${p.verified ? badge("ID verified") : ""}<span>${p.rating_count ? Number(p.rating).toFixed(1) + " / 5 · " + p.rating_count + " reviews" : "New freelancer"}</span></div><p>${esc(p.bio.slice(0, 170))}</p>${chips(p.skills.slice(0, 6))}<p class="muted">${p.finished_jobs} completed jobs</p><a class="btn" href="/freelancers/${esc(p.id)}">View profile & invite</a></article>`).join("") || empty("No freelancers match these filters. Try another skill or country.")}</div>${pagination(data, params)}`);
    bindForm("#marketFilters", async form => { const query = new URLSearchParams(new FormData(form)); location.href = "/freelancers?" + query; });
  }
  function pagination(data, params) {
    const link = (page, label) => { const query = new URLSearchParams(params); query.set("page", page); return `<a class="btn" href="${esc(location.pathname)}?${esc(query.toString())}">${label}</a>`; };
    return `<div class="toolbar">${data.page > 1 ? link(data.page - 1, "Previous") : ""}${data.has_more ? link(data.page + 1, "Next") : ""}</div>`;
  }
  async function publicProfile(id) {
    const data = await api(`/api/marketplace/freelancers/${id}`); const p = data.profile;
    const mine = state.me ? await api("/api/marketplace/me").catch(() => null) : null;
    const openJobs = mine?.jobs.filter(j => j.owner_id === state.me.id && j.status === "open") || [];
    page(p.name, `${heading("FREELANCER PROFILE", p.name, p.title, '<a class="btn" href="/freelancers">Browse talent</a>')}<section class="panel"><div class="market-person">${photo(p)}<div><h2>${esc(p.title)}</h2><p>${esc(p.location)}, ${esc(regionNames.of(p.country))}</p>${p.verified ? badge("ID verified") : ""}</div></div>${stats(p)}<p class="market-bio">${esc(p.bio)}</p>${chips(p.skills)}</section>${portfolio(p)}
      ${shareProfile(p, true)}
      ${state.me?.id === id ? '<p><a class="btn" href="/dashboard">Edit my profile</a></p>' : `<section class="panel"><h2>Invite ${esc(p.name)} to a job</h2>${!p.available ? '<p>This freelancer is not available for new work.</p>' : !state.me ? '<a class="btn primary" href="/register">Create an account to hire</a>' : openJobs.length ? `<form id="marketInvite" class="market-form"><label class="field">Your open job<select name="job_id">${openJobs.map(j => `<option value="${esc(j.id)}">${esc(j.title)} · ${money(j.budget)}</option>`).join("")}</select></label><label class="field">Offer price (USD)<input name="price" type="number" min="1" max="100000" step="0.01" required></label><label class="field">Message<textarea name="message" minlength="20" maxlength="5000" required rows="3"></textarea></label><button class="btn primary" type="submit">Send offer</button><p class="muted">The freelancer can accept or decline. You make the final hiring decision after acceptance.</p></form>` : '<p>Publish a job with a funded balance first.</p><a class="btn primary" href="/marketplace/jobs">Create a job</a>'}</section>`}
      <h2>Completed work & reviews</h2>${data.reviews.map(r => `<article class="panel"><h3>${esc(r.title)}</h3><p>${r.rating} / 5 · ${esc(date(r.approved_at))}</p><p>${esc(r.review || "No written review.")}</p></article>`).join("") || empty("No completed jobs yet.")}`);
    bindProfileShare();
    bindForm("#marketInvite", async form => { const v = Object.fromEntries(new FormData(form)); await post(`/api/marketplace/jobs/${v.job_id}/proposals`, { freelancer_id: id, price: cents(v.price), message: v.message }); message("Offer sent. Track their response in My jobs & offers."); form.reset(); });
  }
  async function findJobs() {
    const params = new URLSearchParams(location.search); const data = await api(`/api/marketplace/jobs?${params}`);
    page("Find jobs", `${heading("DO WORK THAT FITS YOU", "Your next project starts here", "Browse open fixed-price jobs and send a proposal.", '<a class="btn" href="/marketplace/jobs">My jobs & offers</a>')}${notice()}<form id="marketJobSearch" class="panel market-filters"><label class="field">Search jobs<input name="q" value="${esc(params.get("q") || "")}" maxlength="100" placeholder="Website, design, marketing..."></label><label class="field">Skill<input name="skill" value="${esc(params.get("skill") || "")}" placeholder="Any skill"></label><button class="btn primary" type="submit">Search jobs</button></form>${jobCards(data.jobs)}${pagination(data, params)}`);
    bindForm("#marketJobSearch", async form => { location.href = "/find-jobs?" + new URLSearchParams(new FormData(form)); });
  }
  async function myJobs() {
    const data = await api("/api/marketplace/me");
    page("My jobs & offers", `${heading("MAKE WORK HAPPEN", "My jobs & offers", "Manage published jobs, active contracts, proposals and invitations.", '<a class="btn" href="/freelancers">Find freelancers</a><a class="btn" href="/wallet">Top up balance</a>')}
      <details class="panel"><summary><strong>Publish a new job</strong></summary><p class="market-notice">Top up before publishing. Your unreserved balance is refundable, less actual payment/refund transaction costs. The agreed payment is reserved when you hire.</p><form id="marketNewJob" class="market-form"><label class="field">Job title<input name="title" minlength="5" maxlength="160" required></label><label class="field">Scope, deliverables and expectations<textarea name="description" rows="5" minlength="30" maxlength="10000" required></textarea></label><label class="field">Fixed-price budget (USD)<input name="budget" type="number" min="1" max="100000" step="0.01" required></label>${skillPicker()}<button class="btn primary" type="submit">Publish job</button></form></details>
      <h2>Your jobs</h2>${jobCards(data.jobs)}<h2>Your bids & invitations</h2>${data.proposals.map(p => `<article class="panel"><div class="toolbar">${badge(p.kind)}${badge(p.status)}<strong>${money(p.price)}</strong><a class="btn" href="/marketplace/jobs/${esc(p.job_id)}">View job & respond</a></div><p>${esc(p.message)}</p></article>`).join("") || empty("You have no bids or invitations yet.")}`);
    bindForm("#marketNewJob", async form => { const v = Object.fromEntries(new FormData(form)); const result = await post("/api/marketplace/jobs", { title: v.title, description: v.description, budget: cents(v.budget), skills: skillsValue(form) }); location.href = `/marketplace/jobs/${result.job.id}`; });
  }
  async function jobDetail(id) {
    const data = await api(`/api/marketplace/jobs/${id}`); const j = data.job; const owner = state.me.id === j.owner_id; const hired = state.me.id === j.freelancer_id;
    const me = await api("/api/marketplace/me");
    const ownProposal = data.proposals.find(p => p.freelancer_id === state.me.id);
    page(j.title, `${heading("FIXED-PRICE PROJECT", j.title, `Published by ${j.owner_name}`, '<a class="btn" href="/marketplace/jobs">My jobs</a>')}<section class="panel"><div class="toolbar"><strong class="market-large">${money(j.price || j.budget)}</strong>${badge(j.status)}</div><p class="market-bio">${esc(j.description)}</p>${chips(j.skills)}<p class="muted">${owner ? "Your reserved payment is released on approval." : "Platform commission: 5%. You receive " + money((j.price || j.budget) - Math.round((j.price || j.budget) * .05)) + "."} Earnings unlock seven days after employer approval.</p>${j.available_at ? `<p>Withdrawal eligibility: ${esc(date(j.available_at))}</p>` : ""}${owner && j.status === "open" ? '<a class="btn primary" href="/freelancers">Find freelancers to invite</a> <button class="btn" data-job-action="cancel">Cancel open job</button>' : ""}</section>
      ${!owner && j.status === "open" && !ownProposal ? `<section class="panel"><h2>Send a proposal</h2><p>You have ${me.profile.connects} Connects. This bid costs 10 Connects. One proposal per job.</p><form id="marketBid" class="market-form"><label class="field">Your fixed price (USD)<input name="price" type="number" min="1" max="100000" step="0.01" value="${j.budget / 100}" required></label><label class="field">Explain your approach<textarea name="message" minlength="20" maxlength="5000" rows="4" required></textarea></label><button class="btn primary" type="submit" ${me.profile.connects < 10 ? "disabled" : ""}>Submit bid · 10 Connects</button></form></section>` : ""}
      ${data.proposals.length ? `<h2>${owner ? "Applicants & invited freelancers" : "Your proposal / invitation"}</h2>${data.proposals.map(p => `<article class="panel"><div class="toolbar"><a href="/freelancers/${esc(p.freelancer_id)}"><strong>${esc(p.name)}</strong></a>${badge(p.kind)}${badge(p.status)}<strong>${money(p.price)}</strong></div><p class="market-bio">${esc(p.message)}</p><div class="toolbar">${!owner && p.status === "offered" && j.status === "open" ? `<button class="btn primary" data-proposal="${p.id}" data-action="accept">Accept offer</button><button class="btn" data-proposal="${p.id}" data-action="decline">Decline offer</button>` : ""}${owner && j.status === "open" && ["submitted", "accepted"].includes(p.status) ? `<button class="btn primary" data-proposal="${p.id}" data-action="hire">Hire & reserve ${money(p.price)}</button>` : ""}</div></article>`).join("")}` : ""}
      ${hired && j.status === "hired" ? `<section class="panel"><h2>Submit completed work</h2><form id="marketDeliver" class="market-form"><label class="field">Deliverables and access instructions<textarea name="delivery" rows="5" minlength="20" maxlength="10000" required>${esc(j.delivery || "")}</textarea></label><button class="btn primary" type="submit">Submit for approval</button></form></section>` : ""}
      ${(owner || hired) && j.delivery ? `<section class="panel"><h2>Submitted work</h2><p class="market-bio">${esc(j.delivery)}</p></section>` : ""}
      ${owner && j.status === "submitted" ? `<section class="panel"><h2>Review & approve</h2><form id="marketApprove" class="market-form"><label class="field">Rating<select name="rating" required><option value="">Choose rating</option>${[5, 4, 3, 2, 1].map(r => `<option value="${r}">${r} / 5</option>`).join("")}</select></label><label class="field">Public review<textarea name="review" maxlength="2000" rows="3"></textarea></label><p>Approval releases ${money(j.price)} from your reserved funds. The freelancer receives ${money(j.price - Math.round(j.price * .05))} after the 5% fee, held for seven days.</p><button class="btn primary" type="submit">Approve work & payment</button><button class="btn" type="button" data-job-action="revise">Request changes</button></form></section>` : ""}${j.status === "completed" ? `<section class="panel"><h2>Employer review · ${j.rating} / 5</h2><p>${esc(j.review || "No written review.")}</p></section>` : ""}`);
    bindForm("#marketBid", async form => { const v = Object.fromEntries(new FormData(form)); await post(`/api/marketplace/jobs/${id}/proposals`, { price: cents(v.price), message: v.message }); await jobDetail(id); message("Proposal submitted."); });
    bindForm("#marketDeliver", async form => { await post(`/api/marketplace/jobs/${id}/submit`, Object.fromEntries(new FormData(form))); await jobDetail(id); });
    bindForm("#marketApprove", async form => { const v = Object.fromEntries(new FormData(form)); await post(`/api/marketplace/jobs/${id}/approve`, { rating: Number(v.rating), review: v.review }); await jobDetail(id); });
    bindButtons("[data-proposal]", async b => { await post(`/api/marketplace/proposals/${b.dataset.proposal}/${b.dataset.action}`); await jobDetail(id); });
    bindButtons("[data-job-action]", async b => { await post(`/api/marketplace/jobs/${id}/${b.dataset.jobAction}`); await jobDetail(id); });
  }
  async function wallet() {
    const params = new URLSearchParams(location.search); let captureMessage = "";
    if (params.has("topup")) {
      try { await post(`/api/marketplace/topup/${encodeURIComponent(params.get("topup"))}/capture`); captureMessage = "Payment verified and wallet credited."; history.replaceState(null, "", "/wallet"); }
      catch (err) { captureMessage = err.message; }
    }
    const data = await api("/api/marketplace/wallet"); const w = data.wallet;
    page("Wallet", `${heading("YOUR MONEY", "Wallet & payments", "All balances are in USD. Track hiring funds, earnings and settlement requests.")}${captureMessage ? `<p class="market-notice">${esc(captureMessage)}</p>` : ""}${params.has("cancelled") ? '<p class="market-notice">Checkout cancelled. No wallet credit was added.</p>' : ""}
      <section class="panel market-stats"><div><strong>${money(w.deposits)}</strong><span>Available hiring balance</span></div><div><strong>${money(w.reserved)}</strong><span>Reserved for active jobs</span></div><div><strong>${money(w.pending)}</strong><span>Earnings on 7-day hold</span></div><div><strong>${money(w.earnings)}</strong><span>Available to withdraw</span></div></section>
      <div class="market-columns"><section class="panel"><h2>Top up hiring balance</h2><p class="market-notice">Your unused, unreserved balance is refundable. Actual payment/refund transaction costs may be deducted, so the refunded amount can be lower than the deposit. Funds reserved for active work cannot be refunded.</p><form id="marketTopup" class="market-form"><label class="field">Amount (USD)<input name="amount" type="number" min="1" max="100000" step="0.01" required></label><button type="submit" class="btn primary">Continue to payment</button></form></section>
      <section class="panel"><h2>Request a refund or withdrawal</h2><p>Withdrawals require approved identity verification and earnings past the seven-day hold. Requests are reviewed and paid by the platform owner.</p><form id="marketTransfer" class="market-form"><label class="field">Request type<select name="kind"><option value="withdrawal">Withdraw available earnings</option><option value="refund">Refund unused hiring balance</option></select></label><label class="field">Amount (USD)<input name="amount" type="number" min="1" max="100000" step="0.01" required></label><label class="field">PayPal email / original payment reference<input name="destination" minlength="5" maxlength="250" required></label><label class="market-check"><input name="accept_fees" type="checkbox" required><span>I acknowledge that actual provider transaction costs will be deducted from this amount. Refunds return to the original payment method after verification. The 5% platform commission was already deducted from earnings.</span></label><button class="btn primary" type="submit">Submit request</button></form></section></div>
      <section class="panel"><h2>Earnings & release dates</h2>${data.earnings.length ? `<div class="market-table-wrap"><table><thead><tr><th>Job</th><th>Net earnings</th><th>Platform fee</th><th>Available from</th><th>Status</th></tr></thead><tbody>${data.earnings.map(e => `<tr><td><a href="/marketplace/jobs/${esc(e._id)}">View job</a></td><td>${money(e.amount)}</td><td>${money(e.fee)}</td><td>${esc(date(e.available_at))}</td><td>${badge(e.status)}</td></tr>`).join("")}</tbody></table></div>` : empty("No earnings yet.")}</section>
      <section class="panel"><h2>Payment history</h2>${data.transfers.length ? `<div class="market-table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Transaction fee</th><th>Status / reference</th></tr></thead><tbody>${data.transfers.map(t => `<tr><td>${esc(date(t.created_at))}</td><td>${esc(t.kind)}</td><td>${money(t.amount)}${t.status === "paid" ? `<small>Net sent ${money(t.amount - t.fee)}</small>` : ""}</td><td>${money(t.fee)}</td><td>${badge(t.status)}${t.payment_reference ? `<small style="overflow-wrap:anywhere">Reference: ${esc(t.payment_reference)}</small>` : ""}<small>${esc(t.external_id || "")}</small>${t.kind === "topup" && t.status === "pending" ? `<button class="btn" data-capture="${t.id}">Verify PayPal payment</button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : empty("No payments yet.")}</section><p><a href="/marketplace/privacy">Marketplace privacy & payment terms</a></p>`);
    bindForm("#marketTopup", async form => { const result = await post("/api/marketplace/topup", { amount: cents(new FormData(form).get("amount")) }); await openEmbeddedCheckout({ api, title: "Hiring balance", description: "Add funds to hire freelancers. Unused, unreserved balance is refundable; payment and refund transaction costs may be deducted.", amount: result.amount, orderID: result.order_id, captureURL: `/api/marketplace/topup/${encodeURIComponent(result.transfer_id)}/capture`, fallbackURL: result.url, onSuccess: async () => { await wallet(); message("Payment verified and wallet credited."); } }); });
    bindForm("#marketTransfer", async form => { const v = Object.fromEntries(new FormData(form)); await post("/api/marketplace/transfers", { kind: v.kind, amount: cents(v.amount), destination: v.destination, accept_fees: !!v.accept_fees }); await wallet(); message("Request queued for owner settlement. The requested amount is held out of your available balance."); });
    bindButtons("[data-capture]", async b => { await post(`/api/marketplace/topup/${b.dataset.capture}/capture`); await wallet(); message("Payment verified."); });
  }
  let connectSearch = "", connectPage = 1;
  const connectSelection = new Set();
  let grantRequestID = "";
  let grantPayload = "";
  function connectsAdminHTML(data) {
    return `<section class="panel"><h2>Connects allowance & reset schedule</h2>
      <form id="connectsPolicy" class="market-form"><div class="grid-2">
      <label class="field">Free Connects per reset<input name="amount" type="number" min="0" max="100000" step="1" value="${data.policy.amount}" required></label>
      <label class="field">Reset schedule<select name="period"><option value="weekly" ${data.policy.period === "weekly" ? "selected" : ""}>Weekly — Monday, 00:00 UTC</option><option value="monthly" ${data.policy.period === "monthly" ? "selected" : ""}>Monthly — first day, 00:00 UTC</option></select></label></div>
      <p class="muted">Existing balances stay unchanged until the next boundary on the selected schedule. At reset, the whole balance is replaced with this allowance, including any unused manual grants. New users receive this allowance immediately. Set 0 to disable free refills.</p>
      <button type="submit" class="btn primary">Save Connects policy</button></form></section>
      <section class="panel"><h2>Give Connects to users</h2><p>Select one user for an individual grant, or up to 200 for a bulk grant. The amount is added to each user's balance.</p>
      <form id="connectsSearch" class="market-filters"><label class="field">Find users by name or email<input name="q" maxlength="100" value="${esc(connectSearch)}"></label><button class="btn" type="submit">Search users</button></form>
      <div class="toolbar"><button class="btn" type="button" id="connectsSelectPage">Select this page</button><button class="btn" type="button" id="connectsClear">Clear selection</button><span id="connectsSelectedCount">${connectSelection.size} selected</span></div>
      <div class="market-connect-users">${data.users.map(u => `<label class="market-check"><input type="checkbox" data-connect-user="${esc(u.id)}" ${connectSelection.has(u.id) ? "checked" : ""}><span><strong>${esc(u.name || u.email)}</strong><br><small>${esc(u.email)}</small></span></label>`).join("") || empty("No matching users.")}</div>
      <div class="toolbar">${data.page > 1 ? '<button class="btn" type="button" data-connect-page="-1">Previous</button>' : ""}<span>Page ${data.page}</span>${data.has_more ? '<button class="btn" type="button" data-connect-page="1">Next</button>' : ""}</div>
      <form id="connectsGrant" class="market-form"><label class="field">Connects to add per selected user<input name="amount" type="number" min="1" max="100000" step="1" required></label><label class="field">Reason<input name="reason" minlength="3" maxlength="500" required placeholder="Promotion, support adjustment, bonus..."></label><p class="muted">Manual grants expire at the next scheduled reset. A bulk grant succeeds for all selected users or none.</p><button type="submit" class="btn primary">Give Connects to selected users</button></form></section>
      <section class="panel"><h2>Recent manual grants</h2>${data.grants.length ? `<div class="market-table-wrap"><table><thead><tr><th>Date</th><th>Users</th><th>Connects each</th><th>Reason</th></tr></thead><tbody>${data.grants.map(g => `<tr><td>${esc(date(g.created_at))}</td><td><details><summary>${g.user_ids.length} users</summary>${g.user_ids.map(id => `<div>${esc(id)}</div>`).join("")}</details></td><td>${Number(g.amount)}</td><td>${esc(g.reason)}</td></tr>`).join("")}</tbody></table></div>` : empty("No manual grants yet.")}</section>`;
  }
  function bindConnectsAdmin(data) {
    const updateSelection = () => {
      $("#connectsSelectedCount").textContent = `${connectSelection.size} selected`;
      document.querySelectorAll("[data-connect-user]").forEach(input => { input.checked = connectSelection.has(input.dataset.connectUser); });
    };
    document.querySelectorAll("[data-connect-user]").forEach(input => input.addEventListener("change", () => {
      if (input.checked && connectSelection.size >= 200) { input.checked = false; message("Select up to 200 users per grant.", true); return; }
      if (input.checked) connectSelection.add(input.dataset.connectUser); else connectSelection.delete(input.dataset.connectUser);
      updateSelection();
    }));
    bindButtons("#connectsSelectPage", () => { for (const u of data.users) { if (connectSelection.size >= 200) break; connectSelection.add(u.id); } updateSelection(); });
    bindButtons("#connectsClear", () => { connectSelection.clear(); updateSelection(); });
    bindButtons("[data-connect-page]", async button => { connectPage += Number(button.dataset.connectPage); await admin(); });
    bindForm("#connectsSearch", async form => { connectSearch = new FormData(form).get("q").trim(); connectPage = 1; await admin(); });
    bindForm("#connectsPolicy", async form => {
      const v = Object.fromEntries(new FormData(form));
      await api("/api/marketplace/admin/connects/policy", { method: "PUT", body: JSON.stringify({ amount: Number(v.amount), period: v.period }) });
      await admin(); message("Connects policy saved. Existing balances change at the next scheduled reset.");
    });
    bindForm("#connectsGrant", async form => {
      if (!connectSelection.size) throw new Error("Select at least one user.");
      const v = Object.fromEntries(new FormData(form));
      const payload = { user_ids: [...connectSelection].sort(), amount: Number(v.amount), reason: v.reason };
      const signature = JSON.stringify(payload);
      if (signature !== grantPayload) { grantPayload = signature; grantRequestID = crypto.randomUUID(); }
      const result = await post("/api/marketplace/admin/connects/grants", { ...payload, request_id: grantRequestID });
      connectSelection.clear(); grantPayload = ""; grantRequestID = "";
      await admin(); message(`Added ${result.amount_each} Connects each to ${result.granted} users.`);
    });
  }
  async function admin() {
    const [data, connects] = await Promise.all([api("/api/marketplace/admin"), api("/api/marketplace/admin/connects?" + new URLSearchParams({ q: connectSearch, page: connectPage }))]);
    page("Marketplace administration", `${heading("PLATFORM OWNER", "Marketplace administration", "Review identity submissions and settle refund / withdrawal requests.")}<section class="panel"><h2>Platform commission earned</h2><strong class="market-large">${money(data.commission)}</strong><p class="muted">5% of approved job payments. Commission is recorded at approval.</p></section>
      ${connectsAdminHTML(connects)}
      <h2>Identity review</h2>${data.profiles.map(p => `<article class="panel"><div class="toolbar"><strong>${esc(p.name)}</strong><span>${esc(p.id)}</span><button class="btn" data-id-view="${p.id}">View private ID</button><button class="btn primary" data-id-review="${p.id}" data-revision="${p.identity_revision}" data-status="verified">Approve verification</button><button class="btn" data-id-review="${p.id}" data-revision="${p.identity_revision}" data-status="rejected">Reject</button></div></article>`).join("") || empty("No IDs waiting for review.")}
      <h2>Settlement queue</h2><p class="market-notice">Send payments through your payment provider before marking them paid. Verify identity for withdrawals and return refunds to the original payment method. Record the actual transaction fee and a unique payment reference. This screen records settlement; it does not send money.</p>
      ${data.transfers.map(t => `<section class="panel"><h3>${esc(t.kind)} · ${money(t.amount)}</h3><p>User: ${esc(t.user_id)}</p><p>Destination / reference: ${esc(t.destination)}</p><p>Requested: ${esc(date(t.created_at))}</p>${t.payment_reference ? `<label class="field">Copy this code into the PayPal payment note<input readonly value="${esc(t.payment_reference)}" onclick="this.select()"></label>` : ""}<form class="market-settlement market-form" data-transfer="${t.id}"><label class="field">Actual transaction fee (USD)<input type="number" name="fee" min="0" max="${(t.amount - 1) / 100}" step="0.01" value="0" required></label><label class="field">Completed payment reference<input name="reference" minlength="5" maxlength="200" required></label><label class="market-check"><input type="checkbox" required><span>I have verified the recipient and sent the requested amount minus the recorded fee.</span></label><button class="btn primary" type="submit">Record as paid</button><button class="btn" type="button" data-reject-transfer="${t.id}">Reject & restore balance</button></form></section>`).join("") || empty("No pending settlement requests.")}`);
    bindConnectsAdmin(connects);
    bindButtons("[data-id-view]", b => showIdentity(b.dataset.idView));
    bindButtons("[data-id-review]", async b => { await post(`/api/marketplace/admin/identity/${b.dataset.idReview}`, { status: b.dataset.status, revision: b.dataset.revision }); await admin(); });
    document.querySelectorAll(".market-settlement").forEach((form, i) => { form.id = `marketSettlement${i}`; bindForm(`#${form.id}`, async f => { const v = Object.fromEntries(new FormData(f)); await post(`/api/marketplace/admin/transfers/${f.dataset.transfer}`, { status: "paid", reference: v.reference, fee: cents(v.fee) }); await admin(); }); });
    bindButtons("[data-reject-transfer]", async b => { await post(`/api/marketplace/admin/transfers/${b.dataset.rejectTransfer}`, { status: "rejected", fee: 0 }); await admin(); });
  }
  async function openFreelancerHelp({ tasks = [], websiteName = "Website" } = {}) {
    if (document.querySelector("#freelancerHelpDialog")) return;
    const dialog = document.createElement("dialog");
    dialog.id = "freelancerHelpDialog";
    dialog.className = "modal fh-dialog marketplace";
    dialog.setAttribute("aria-labelledby", "fhTitle");
    dialog.innerHTML = `<div class="modal-head"><div><h2 id="fhTitle">Find Freelancer Help</h2><p class="muted">${esc(websiteName)}</p></div><button type="button" class="btn" data-fh-close aria-label="Close freelancer finder">Close</button></div>
      <details class="market-notice" open><summary>What is Find FH?</summary><p>Find freelancers to help with a task on this board. Review their profiles, then send an offer. They can accept or decline; you make the final hiring decision in <a href="/marketplace/jobs" target="_blank" rel="noopener">My jobs & offers</a>.</p><p>Complete your <a href="/dashboard" target="_blank" rel="noopener">profile</a> and <a href="/wallet" target="_blank" rel="noopener">fund your hiring balance</a> before publishing. Unused balance is refundable less actual transaction costs. Sending an offer does not hire anyone or reserve funds.</p></details>
      <form class="fh-filters" data-fh-filters>
        <label class="field">Skill<input name="skill" list="fhSkills" placeholder="Any skill, including custom skills"><datalist id="fhSkills"></datalist></label>
        <label class="field">Country<select name="country">${countryOptions().replace("Choose country", "Any country")}</select></label>
        <label class="field">Availability<select name="availability"><option value="">Everyone</option><option value="available" selected>Available now</option><option value="busy">Busy</option><option value="running_project">In a running project</option></select></label>
        <label class="field">Completed-job rating<select name="rating"><option value="">Any rating</option><option value="3">3+ stars</option><option value="4">4+ stars</option><option value="4.5">4.5+ stars</option><option value="5">5 stars</option></select></label>
        <label class="field">Completed jobs<select name="finished_jobs"><option value="">Any experience</option><option value="1">1+</option><option value="5">5+</option><option value="10">10+</option><option value="50">50+</option></select></label>
        <button class="btn primary" type="submit">Apply filters</button>
      </form>
      <div class="toolbar fh-results-head"><span data-fh-count></span><div role="group" aria-label="Freelancer display"><button class="btn" type="button" data-fh-view="grid" aria-pressed="true">Grid view</button><button class="btn" type="button" data-fh-view="list" aria-pressed="false">List view</button></div></div>
      <p data-fh-status role="status" aria-live="polite"></p><div data-fh-results class="fh-results"></div>
      <div class="toolbar"><button type="button" class="btn" data-fh-prev>Previous</button><span data-fh-page></span><button type="button" class="btn" data-fh-next>Next</button></div>
      <section class="panel fh-offer" data-fh-offer hidden></section>`;
    document.body.append(dialog);
    dialog.showModal();
    const find = selector => dialog.querySelector(selector);
    let pageNumber = 1, request = 0, profiles = [], jobs = [], busy = false, closed = false;
    let view = "grid";
    try { view = localStorage.getItem("fh-view") === "list" ? "list" : "grid"; } catch {}
    const status = (text, error = false) => { find("[data-fh-status]").textContent = text; find("[data-fh-status]").className = error ? "market-error" : "muted"; };
    const close = () => { if (busy) return; closed = true; dialog.close(); dialog.remove(); };
    find("[data-fh-close]").onclick = close;
    dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
    function setView(value) {
      view = value;
      find("[data-fh-results]").classList.toggle("fh-list", view === "list");
      dialog.querySelectorAll("[data-fh-view]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.fhView === view)));
      try { localStorage.setItem("fh-view", view); } catch {}
    }
    dialog.querySelectorAll("[data-fh-view]").forEach(button => { button.onclick = () => setView(button.dataset.fhView); });
    setView(view);
    async function load() {
      const current = ++request;
      status("Loading freelancers...");
      find("[data-fh-prev]").disabled = true;
      find("[data-fh-next]").disabled = true;
      const query = new URLSearchParams(new FormData(find("[data-fh-filters]")));
      query.set("page", pageNumber);
      try {
        const data = await api(`/api/marketplace/freelancers?${query}`);
        if (closed || current !== request) return;
        profiles = data.freelancers.filter(p => p.id !== state.me?.id);
        find("[data-fh-count]").textContent = `${profiles.length} freelancers on this page`;
        find("[data-fh-page]").textContent = `Page ${pageNumber}`;
        find("[data-fh-prev]").disabled = pageNumber <= 1;
        find("[data-fh-next]").disabled = !data.has_more;
        find("[data-fh-results]").innerHTML = profiles.map(p => `<article class="panel fh-person"><div class="market-person">${photo(p)}<div><h3>${esc(p.name)}</h3><p>${esc(p.title)}</p><p class="muted">${esc(p.location)}${p.country ? ", " + esc(regionNames.of(p.country)) : ""}</p></div></div><div class="fh-person-detail"><div class="toolbar">${badge(availabilityLabel(p))}${p.verified ? badge("ID verified") : ""}</div><p>${p.rating_count ? `${Number(p.rating).toFixed(1)} / 5 from ${Number(p.rating_count)} completed-job reviews` : "No completed-job reviews yet"} · ${Number(p.finished_jobs || 0)} jobs completed</p><p>${esc((p.bio || "").slice(0, 160))}</p>${chips((p.skills || []).slice(0, 8))}</div><div class="toolbar"><a class="btn" href="/freelancers/${esc(p.id)}" target="_blank" rel="noopener">View profile & reviews</a><button type="button" class="btn primary" data-fh-invite="${esc(p.id)}" ${!p.available ? "disabled" : ""}>Offer task</button></div></article>`).join("") || empty("No freelancers match. Try another skill, country or rating.");
        dialog.querySelectorAll("[data-fh-invite]").forEach(button => { button.onclick = () => { if (!busy) offer(profiles.find(p => p.id === button.dataset.fhInvite)); }; });
        status("");
      } catch (error) { if (!closed && current === request) { find("[data-fh-results]").innerHTML = ""; status(error.message, true); } }
    }
    find("[data-fh-filters]").onsubmit = event => { event.preventDefault(); pageNumber = 1; load(); };
    find("[data-fh-prev]").onclick = () => { pageNumber--; load(); };
    find("[data-fh-next]").onclick = () => { pageNumber++; load(); };
    function offer(person) {
      const mount = find("[data-fh-offer]");
      mount.hidden = false;
      mount.innerHTML = `<h3>Offer a task to ${esc(person.name)}</h3><form class="market-form" data-fh-send>
        <label class="field">Task or existing job<select name="source" required><option value="">Choose a task or job</option>${tasks.map(t => `<option value="task:${esc(t.id)}">Board task: ${esc(t.title)}</option>`).join("")}${jobs.map(j => `<option value="job:${esc(j.id)}">Open job: ${esc(j.title)}</option>`).join("")}</select></label>
        ${!tasks.length && !jobs.length ? '<p>Add a board task or <a href="/marketplace/jobs" target="_blank" rel="noopener">publish a job</a> first.</p>' : ""}
        <div data-fh-new hidden><label class="field">Public job title<input name="title" minlength="5" maxlength="160"></label><label class="field">Public scope and deliverables<textarea name="description" minlength="30" maxlength="10000" rows="4"></textarea></label><label class="field">Required skills, separated by commas<input name="skills" placeholder="WordPress, PHP, custom skill"></label><label class="market-check"><input type="checkbox" name="publish_consent"><span>I reviewed this description and agree to publish it as an open marketplace job. It contains no private client details or credentials.</span></label></div>
        <label class="field">Offer price / new job budget (USD)<input name="price" type="number" min="1" max="100000" step="0.01" required></label>
        <label class="field">Private invitation message<textarea name="message" minlength="20" maxlength="5000" rows="3" required></textarea></label>
        <button type="submit" class="btn primary">Send offer</button><p data-fh-offer-status role="status" aria-live="polite"></p>
      </form>`;
      const form = find("[data-fh-send]");
      const fields = form.elements;
      const note = find("[data-fh-offer-status]");
      fields.message.value = "Hello, I would like your help with this task. Please review the scope and let me know if you are interested.";
      fields.source.onchange = () => {
        const isNew = fields.source.value.startsWith("task:");
        find("[data-fh-new]").hidden = !isNew;
        for (const name of ["title", "description", "skills", "publish_consent"]) { fields[name].required = isNew; fields[name].disabled = !isNew; }
        fields.publish_consent.checked = false;
        if (isNew) {
          const task = tasks.find(t => "task:" + t.id === fields.source.value);
          fields.title.value = task?.title || "";
          // Task content may be rich HTML. Copy plain text only for owner review.
          const parsed = new DOMParser().parseFromString(task?.content || task?.comment || "", "text/html");
          fields.description.value = parsed.body.textContent || "";
          fields.skills.value = find("[data-fh-filters]").elements.skill.value;
        } else {
          const job = jobs.find(j => "job:" + j.id === fields.source.value);
          fields.price.value = job ? (job.budget / 100).toFixed(2) : "";
        }
      };
      fields.source.onchange();
      form.onsubmit = async event => {
        event.preventDefault();
        if (busy || !form.reportValidity()) return;
        busy = true;
        form.querySelectorAll("input,select,textarea").forEach(field => { field.disabled = true; });
        const button = form.querySelector('[type="submit"]');
        button.disabled = true;
        find("[data-fh-close]").disabled = true;
        note.textContent = "Sending offer...";
        try {
          const price = cents(fields.price.value);
          let jobID = fields.source.value.replace(/^job:/, "");
          if (fields.source.value.startsWith("task:")) {
            const data = await post("/api/marketplace/jobs", { source_task_id: fields.source.value.slice(5), title: fields.title.value, description: fields.description.value, skills: fields.skills.value.split(","), budget: price });
            jobID = data.job.id;
            jobs.push(data.job);
            // Keep the published job if invitation delivery fails, so retry cannot publish it twice.
            const option = document.createElement("option");
            option.value = "job:" + jobID; option.textContent = "Open job: " + data.job.title;
            fields.source.append(option); fields.source.value = option.value;
            fields.source.onchange();
          }
          await post(`/api/marketplace/jobs/${encodeURIComponent(jobID)}/proposals`, { freelancer_id: person.id, price, message: fields.message.value });
          mount.innerHTML = `<h3>Offer sent to ${esc(person.name)}</h3><p>Wait for their response, then choose whether to hire and reserve payment.</p><a class="btn primary" href="/marketplace/jobs/${esc(jobID)}" target="_blank" rel="noopener">Track offer & hire</a><p>You can offer this open job to other freelancers using their Offer task button.</p>`;
        } catch (error) { note.textContent = error.message + " You can retry or check My jobs & offers."; }
        finally {
          busy = false; button.disabled = false; find("[data-fh-close]").disabled = false;
          form.querySelectorAll("input,select,textarea").forEach(field => { field.disabled = false; });
          const isNew = fields.source.value.startsWith("task:");
          for (const name of ["title", "description", "skills", "publish_consent"]) fields[name].disabled = !isNew;
        }
      };
      mount.scrollIntoView({ behavior: "smooth", block: "nearest" });
      fields.source.focus();
    }
    const preparations = await Promise.allSettled([api("/api/marketplace/skills"), api("/api/marketplace/me"), load()]);
    if (closed) return;
    if (preparations[0].status === "fulfilled") find("#fhSkills").innerHTML = preparations[0].value.skills.map(skill => `<option value="${esc(skill)}"></option>`).join("");
    if (preparations[1].status === "fulfilled") jobs = preparations[1].value.jobs.filter(j => j.owner_id === state.me?.id && j.status === "open");
    else status("Freelancers are available to browse. Complete your profile before sending offers.", true);
  }

  async function render(path) {
    const catalog = await api("/api/marketplace/skills");
    skillCatalog = catalog.skills; connectsPolicy = catalog.connects_policy || connectsPolicy;
    if (path === "/freelancers") return directory();
    if (path.startsWith("/freelancers/")) return publicProfile(path.split("/")[2]);
    if (path === "/find-jobs") return findJobs();
    if (path === "/wallet") return wallet();
    if (path === "/marketplace/jobs") return myJobs();
    if (path.startsWith("/marketplace/jobs/")) return jobDetail(path.split("/")[3]);
    if (path === "/admin/marketplace") return admin();
    return dashboard();
  }
  return { render, openFreelancerHelp };
}
