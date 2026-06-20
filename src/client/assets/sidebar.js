const SIDEBAR_STATE_KEY = "gopher.sidebar.state.v1";
const SIDEBAR_GROUPS_KEY = "gopher.sidebar.groups.v1";
const NAV_CONFIG_URL = "/assets/sidebar-nav.json";

const ICONS = {
    dashboard: `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 3h6v6H3V3Zm8 0h6v3h-6V3ZM11 8h6v9h-6V8ZM3 11h6v6H3v-6Z" fill="currentColor"/></svg>`,
    email: `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 5h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm0 2 7 4 7-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    stream: `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 5h14M3 10h10M3 15h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
    social: `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="6" cy="6" r="2" fill="currentColor"/><circle cx="14" cy="6" r="2" fill="currentColor"/><circle cx="10" cy="14" r="2" fill="currentColor"/><path d="M7.7 7.3 9 12M12.3 7.3 11 12" stroke="currentColor" stroke-width="1.4"/></svg>`,
    bluesky: `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 5c2 1 4 4 6 7 2-3 4-6 6-7-1 3-3 6-6 9-3-3-5-6-6-9Z" fill="currentColor"/></svg>`,
    mastodon: `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 5.5C5 4.1 6.1 3 7.5 3h5C13.9 3 15 4.1 15 5.5V11c0 3-2.2 5-5 5s-5-2-5-5V5.5Z" fill="currentColor"/></svg>`,
    bookmark: `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M6 3h8a1 1 0 0 1 1 1v13l-5-3-5 3V4a1 1 0 0 1 1-1Z" fill="currentColor"/></svg>`,
    pinboard: `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.6"/><circle cx="10" cy="10" r="2" fill="currentColor"/></svg>`,
    feedbin: `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 14a2 2 0 1 0 0 .01ZM4 9a7 7 0 0 1 7 7M4 5a11 11 0 0 1 11 11" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`,
    dayone: `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 4h10v12H5V4Zm2 3h6M7 10h6M7 13h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
    tools: `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m7 13-4 4m0-5 5-5m5-2 4-4m-1 6-5 5M9 6l5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
    monitor: `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="3" y="4" width="14" height="10" rx="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M8 16h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
    queue: `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 5h12M4 10h9M4 15h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
    model: `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 3 3 7l7 4 7-4-7-4Zm-7 7 7 4 7-4M3 13l7 4 7-4" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`,
    archive: `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 5h14v3H3V5Zm2 4h10v7H5V9Zm3 2h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`
};

function readJson(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
}

function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

function isActivePath(pathname, href) {
    if (!href || href === "#") return false;
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
}

function iconMarkup(name) {
    return ICONS[name] || ICONS.archive;
}

function createStyles() {
    const style = document.createElement("style");
    style.textContent = `
        :root {
            --gopher-sidebar-width: 272px;
            --gopher-sidebar-width-collapsed: 72px;
            --gopher-sidebar-bg: #e8edf3;
            --gopher-sidebar-border: #d7dfe8;
            --gopher-sidebar-text: #1f1f1f;
            --gopher-sidebar-muted: #5f6368;
            --gopher-sidebar-active: #4285f4;
        }

        body.gopher-with-sidebar header,
        body.gopher-with-sidebar main {
            transition: margin-left 180ms ease;
        }

        #gopher-sidebar {
            position: fixed;
            top: 0;
            left: 0;
            height: 100vh;
            width: var(--gopher-sidebar-width);
            background: linear-gradient(180deg, #edf2f7 0%, var(--gopher-sidebar-bg) 100%);
            border-right: 1px solid var(--gopher-sidebar-border);
            z-index: 40;
            transform: translateX(-100%);
            transition: width 180ms ease, transform 180ms ease;
            display: flex;
            flex-direction: column;
        }

        #gopher-sidebar.gopher-open {
            transform: translateX(0);
        }

        #gopher-sidebar.gopher-collapsed {
            width: var(--gopher-sidebar-width-collapsed);
        }

        #gopher-sidebar-backdrop {
            position: fixed;
            inset: 0;
            background: rgba(17, 24, 39, 0.35);
            z-index: 30;
            opacity: 0;
            pointer-events: none;
            transition: opacity 180ms ease;
        }

        #gopher-sidebar-backdrop.gopher-open {
            opacity: 1;
            pointer-events: auto;
        }

        .gopher-sidebar-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 14px 14px 10px;
            border-bottom: 1px solid var(--gopher-sidebar-border);
        }

        .gopher-sidebar-controls {
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }

        .gopher-sidebar-brand {
            display: flex;
            align-items: center;
            gap: 10px;
            color: var(--gopher-sidebar-text);
            min-width: 0;
        }

        .gopher-sidebar-brand-title {
            font-size: 13px;
            font-weight: 700;
            letter-spacing: 0.02em;
            text-transform: uppercase;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .gopher-sidebar-scroll {
            overflow-y: auto;
            padding: 10px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .gopher-section {
            border: 1px solid rgba(95, 99, 104, 0.18);
            background: rgba(255, 255, 255, 0.6);
            border-radius: 14px;
            overflow: hidden;
        }

        .gopher-section-toggle,
        .gopher-item-link,
        .gopher-item-toggle,
        .gopher-icon-button {
            all: unset;
            box-sizing: border-box;
            cursor: pointer;
        }

        .gopher-section-toggle {
            width: 100%;
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px 12px;
            color: var(--gopher-sidebar-text);
        }

        .gopher-label,
        .gopher-section-label,
        .gopher-sub-label {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .gopher-section-label {
            flex: 1;
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.06em;
            text-transform: uppercase;
        }

        .gopher-chevron {
            font-size: 12px;
            color: var(--gopher-sidebar-muted);
            transition: transform 120ms ease;
        }

        .gopher-section-body,
        .gopher-sub-list {
            display: none;
            padding: 0 8px 8px;
        }

        .gopher-section.gopher-expanded .gopher-section-body,
        .gopher-item.gopher-expanded .gopher-sub-list {
            display: block;
        }

        .gopher-section.gopher-expanded .gopher-chevron,
        .gopher-item.gopher-expanded > .gopher-item-toggle .gopher-chevron {
            transform: rotate(90deg);
        }

        .gopher-item {
            margin-top: 4px;
        }

        .gopher-item-link,
        .gopher-item-toggle {
            width: 100%;
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 8px 10px;
            border-radius: 10px;
            color: var(--gopher-sidebar-text);
        }

        .gopher-item-link:hover,
        .gopher-item-toggle:hover,
        .gopher-section-toggle:hover,
        .gopher-icon-button:hover {
            background: rgba(66, 133, 244, 0.1);
        }

        .gopher-item-link.gopher-active {
            background: rgba(66, 133, 244, 0.16);
            color: #0f3e8d;
            font-weight: 600;
        }

        .gopher-label,
        .gopher-sub-label {
            flex: 1;
            font-size: 13px;
        }

        .gopher-sub-list .gopher-item-link,
        .gopher-sub-list .gopher-item-toggle {
            padding-left: 30px;
        }

        .gopher-icon {
            width: 16px;
            height: 16px;
            color: var(--gopher-sidebar-muted);
            flex: 0 0 16px;
        }

        .gopher-active .gopher-icon {
            color: var(--gopher-sidebar-active);
        }

        .gopher-badge {
            font-size: 10px;
            line-height: 1;
            color: #7f1d1d;
            background: #fee2e2;
            border: 1px solid #fecaca;
            border-radius: 999px;
            padding: 3px 6px;
            white-space: nowrap;
        }

        .gopher-icon-button {
            width: 30px;
            height: 30px;
            border-radius: 8px;
            color: var(--gopher-sidebar-muted);
            display: inline-flex;
            align-items: center;
            justify-content: center;
        }

        .gopher-mobile-toggle {
            width: 32px;
            height: 32px;
            border-radius: 8px;
            border: 1px solid #e3e3e3;
            color: #5f6368;
            background: white;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            margin-right: 8px;
        }

        body.gopher-with-sidebar.sidebar-collapsed #gopher-sidebar .gopher-label,
        body.gopher-with-sidebar.sidebar-collapsed #gopher-sidebar .gopher-section-label,
        body.gopher-with-sidebar.sidebar-collapsed #gopher-sidebar .gopher-sub-label,
        body.gopher-with-sidebar.sidebar-collapsed #gopher-sidebar .gopher-badge,
        body.gopher-with-sidebar.sidebar-collapsed #gopher-sidebar .gopher-chevron,
        body.gopher-with-sidebar.sidebar-collapsed #gopher-sidebar .gopher-sidebar-brand-title {
            display: none;
        }

        body.gopher-with-sidebar.sidebar-collapsed #gopher-sidebar .gopher-item-link,
        body.gopher-with-sidebar.sidebar-collapsed #gopher-sidebar .gopher-item-toggle,
        body.gopher-with-sidebar.sidebar-collapsed #gopher-sidebar .gopher-section-toggle {
            justify-content: center;
            padding-left: 8px;
            padding-right: 8px;
        }

        body.gopher-with-sidebar.sidebar-collapsed #gopher-sidebar .gopher-sub-list .gopher-item-link,
        body.gopher-with-sidebar.sidebar-collapsed #gopher-sidebar .gopher-sub-list .gopher-item-toggle {
            padding-left: 8px;
        }

        @media (min-width: 1024px) {
            #gopher-sidebar {
                transform: translateX(0);
            }

            #gopher-sidebar-backdrop {
                display: none;
            }

            body.gopher-with-sidebar header,
            body.gopher-with-sidebar main {
                margin-left: var(--gopher-sidebar-width);
            }

            body.gopher-with-sidebar.sidebar-collapsed header,
            body.gopher-with-sidebar.sidebar-collapsed main {
                margin-left: var(--gopher-sidebar-width-collapsed);
            }

            .gopher-mobile-toggle,
            #gopher-sidebar-close {
                display: none;
            }
        }
    `;
    document.head.appendChild(style);
}

function createIconButton(id, title, text) {
    const button = document.createElement("button");
    button.id = id;
    button.className = "gopher-icon-button";
    button.type = "button";
    button.setAttribute("aria-label", title);
    button.title = title;
    button.textContent = text;
    return button;
}

function createLinkItem(item, pathname) {
    const row = document.createElement("a");
    row.className = "gopher-item-link";
    row.href = item.href || "#";
    if (item.comingSoon) {
        row.addEventListener("click", (event) => event.preventDefault());
    }
    if (isActivePath(pathname, item.href)) {
        row.classList.add("gopher-active");
    }

    const icon = document.createElement("span");
    icon.className = "gopher-icon";
    icon.innerHTML = iconMarkup(item.icon);

    const label = document.createElement("span");
    label.className = "gopher-label";
    label.textContent = item.label;

    row.append(icon, label);

    if (item.comingSoon) {
        const badge = document.createElement("span");
        badge.className = "gopher-badge";
        badge.textContent = "Soon";
        row.appendChild(badge);
    }

    return row;
}

function createNestedItem(item, pathname, groupState) {
    const wrapper = document.createElement("div");
    wrapper.className = "gopher-item";

    const toggle = document.createElement("button");
    toggle.className = "gopher-item-toggle";
    toggle.type = "button";

    const icon = document.createElement("span");
    icon.className = "gopher-icon";
    icon.innerHTML = iconMarkup(item.icon);

    const label = document.createElement("span");
    label.className = "gopher-label";
    label.textContent = item.label;

    const chevron = document.createElement("span");
    chevron.className = "gopher-chevron";
    chevron.textContent = ">";

    toggle.append(icon, label, chevron);

    const subList = document.createElement("div");
    subList.className = "gopher-sub-list";

    let hasActiveChild = false;
    (item.children || []).forEach((child) => {
        const childLink = createLinkItem(child, pathname);
        if (childLink.classList.contains("gopher-active")) {
            hasActiveChild = true;
        }
        subList.appendChild(childLink);
    });

    const nestedKey = `${groupState.sectionId}:${item.label}`;
    const expandedMap = groupState.expandedMap;
    const shouldExpand = hasActiveChild || expandedMap[nestedKey] === true;
    if (shouldExpand) {
        wrapper.classList.add("gopher-expanded");
    }

    toggle.addEventListener("click", () => {
        const expanded = wrapper.classList.toggle("gopher-expanded");
        expandedMap[nestedKey] = expanded;
        writeJson(SIDEBAR_GROUPS_KEY, expandedMap);
    });

    wrapper.append(toggle, subList);
    return wrapper;
}

function createSection(section, pathname, expandedMap) {
    const sectionBox = document.createElement("section");
    sectionBox.className = "gopher-section";

    const headerBtn = document.createElement("button");
    headerBtn.className = "gopher-section-toggle";
    headerBtn.type = "button";

    const icon = document.createElement("span");
    icon.className = "gopher-icon";
    icon.innerHTML = iconMarkup(section.icon);

    const label = document.createElement("span");
    label.className = "gopher-section-label";
    label.textContent = section.title;

    const chevron = document.createElement("span");
    chevron.className = "gopher-chevron";
    chevron.textContent = ">";

    headerBtn.append(icon, label, chevron);

    const body = document.createElement("div");
    body.className = "gopher-section-body";

    let hasActiveChild = false;
    const groupState = {
        sectionId: section.id,
        expandedMap,
    };

    (section.items || []).forEach((item) => {
        if (item.children && item.children.length > 0) {
            const nested = createNestedItem(item, pathname, groupState);
            if (nested.querySelector(".gopher-active")) {
                hasActiveChild = true;
            }
            body.appendChild(nested);
            return;
        }

        const rowWrap = document.createElement("div");
        rowWrap.className = "gopher-item";
        const link = createLinkItem(item, pathname);
        if (link.classList.contains("gopher-active")) {
            hasActiveChild = true;
        }
        rowWrap.appendChild(link);
        body.appendChild(rowWrap);
    });

    const savedExpanded = expandedMap[section.id];
    const shouldExpand = savedExpanded ?? hasActiveChild ?? section.defaultExpanded === true;
    if (shouldExpand) {
        sectionBox.classList.add("gopher-expanded");
    }

    headerBtn.addEventListener("click", () => {
        const expanded = sectionBox.classList.toggle("gopher-expanded");
        expandedMap[section.id] = expanded;
        writeJson(SIDEBAR_GROUPS_KEY, expandedMap);
    });

    sectionBox.append(headerBtn, body);
    return sectionBox;
}

function createSidebarShell() {
    const sidebar = document.createElement("aside");
    sidebar.id = "gopher-sidebar";
    sidebar.setAttribute("aria-label", "Sidebar navigation");

    const header = document.createElement("div");
    header.className = "gopher-sidebar-header";

    const brand = document.createElement("div");
    brand.className = "gopher-sidebar-brand";

    const brandIcon = document.createElement("span");
    brandIcon.className = "gopher-icon";
    brandIcon.innerHTML = iconMarkup("dashboard");

    const brandTitle = document.createElement("div");
    brandTitle.className = "gopher-sidebar-brand-title";
    brandTitle.textContent = "Lumin Navigation";

    brand.append(brandIcon, brandTitle);

    const collapseBtn = createIconButton("gopher-sidebar-collapse", "Collapse sidebar", "<<");
    const closeBtn = createIconButton("gopher-sidebar-close", "Close sidebar", "X");

    const controls = document.createElement("div");
    controls.className = "gopher-sidebar-controls";
    controls.append(collapseBtn, closeBtn);

    header.append(brand, controls);

    const scroll = document.createElement("div");
    scroll.className = "gopher-sidebar-scroll";

    sidebar.append(header, scroll);

    const backdrop = document.createElement("div");
    backdrop.id = "gopher-sidebar-backdrop";

    return { sidebar, scroll, backdrop, collapseBtn, closeBtn };
}

function setupMobileToggle(sidebar, backdrop) {
    const headerRow = document.querySelector("header .max-w-6xl");
    if (!headerRow) return;

    const leftCluster = headerRow.querySelector("div.flex.items-center.gap-3");
    if (!leftCluster) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gopher-mobile-toggle lg:hidden";
    btn.setAttribute("aria-label", "Open navigation");
    btn.textContent = "=";

    btn.addEventListener("click", () => {
        sidebar.classList.add("gopher-open");
        backdrop.classList.add("gopher-open");
    });

    leftCluster.prepend(btn);
}

async function initSidebar() {
    createStyles();

    const pathname = window.location.pathname;
    const sidebarState = readJson(SIDEBAR_STATE_KEY, { collapsed: false });
    const expandedMap = readJson(SIDEBAR_GROUPS_KEY, {});

    const { sidebar, scroll, backdrop, collapseBtn, closeBtn } = createSidebarShell();

    if (sidebarState.collapsed) {
        document.body.classList.add("sidebar-collapsed");
        sidebar.classList.add("gopher-collapsed");
    }

    document.body.classList.add("gopher-with-sidebar");
    document.body.append(sidebar, backdrop);

    setupMobileToggle(sidebar, backdrop);

    collapseBtn.addEventListener("click", () => {
        const collapsed = document.body.classList.toggle("sidebar-collapsed");
        sidebar.classList.toggle("gopher-collapsed", collapsed);
        writeJson(SIDEBAR_STATE_KEY, { collapsed });
        collapseBtn.textContent = collapsed ? ">>" : "<<";
    });

    closeBtn.addEventListener("click", () => {
        sidebar.classList.remove("gopher-open");
        backdrop.classList.remove("gopher-open");
    });

    backdrop.addEventListener("click", () => {
        sidebar.classList.remove("gopher-open");
        backdrop.classList.remove("gopher-open");
    });

    try {
        const response = await fetch(NAV_CONFIG_URL, { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`Failed to load sidebar config (${response.status})`);
        }

        const nav = await response.json();
        (nav.sections || []).forEach((section) => {
            scroll.appendChild(createSection(section, pathname, expandedMap));
        });
    } catch (error) {
        const box = document.createElement("div");
        box.className = "text-xs text-red-700 bg-red-100 border border-red-200 rounded-lg p-3";
        box.textContent = `Sidebar failed to load: ${String(error.message || error)}`;
        scroll.appendChild(box);
    }
}

initSidebar();
