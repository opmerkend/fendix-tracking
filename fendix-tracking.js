/**
 * ============================================
 * FENDIX WEBFLOW TRACKING
 * ============================================
 */

(function() {
  'use strict';

  // ============================================
  // CONFIG
  // ============================================
  
  const CONFIG = {
    debug: window.location.search.includes('debug=true'),
    version: '1.0.0',
    
    // Alleen relevante milestones
    scrollMilestones: [50, 90],
    timeMilestones: [30, 120], // 30 sec, 2 min
    
    // Storage
    storagePrefix: 'fendix_',
    sessionTimeout: 30 * 60 * 1000,
    
    // Jouw site structuur
    collections: {
      'resources': { name: 'Resources', type: 'content' },
      'diensten': { name: 'Diensten', type: 'service' }
    },
    
    // Statische pagina's
    staticPages: {
      '/': { name: 'Homepage', category: 'landing' },
      '/over-ons': { name: 'Over Ons', category: 'about' },
      '/contact': { name: 'Contact', category: 'contact' },
      '/resources': { name: 'Resources Overzicht', category: 'content-list' },
      '/diensten': { name: 'Diensten Overzicht', category: 'service-list' }
    }
  };

  // ============================================
  // UTILITIES
  // ============================================
  
  const log = (...args) => CONFIG.debug && console.log('[Fendix]', ...args);
  
  const storage = {
    get: (key) => {
      try {
        return JSON.parse(localStorage.getItem(CONFIG.storagePrefix + key));
      } catch { return null; }
    },
    set: (key, val) => {
      try {
        localStorage.setItem(CONFIG.storagePrefix + key, JSON.stringify(val));
      } catch (e) { log('Storage error', e); }
    }
  };

  // ============================================
  // PAGE ANALYZER
  // ============================================
  
  function analyzePage() {
    const path = window.location.pathname;
    const pathParts = path.split('/').filter(Boolean);
    
    // Basis info die altijd beschikbaar is
    const page = {
      url: window.location.href,
      path: path,
      title: document.title,
      
      // Meta info
      description: document.querySelector('meta[name="description"]')?.content || null,
      ogTitle: document.querySelector('meta[property="og:title"]')?.content || null,
      ogImage: document.querySelector('meta[property="og:image"]')?.content || null,
      
      // Type detectie
      type: 'static',
      category: null,
      collection: null,
      slug: null,
      itemName: null
    };
    
    // Check of het een statische pagina is
    if (CONFIG.staticPages[path]) {
      page.type = 'static';
      page.category = CONFIG.staticPages[path].category;
      page.itemName = CONFIG.staticPages[path].name;
    }
    // Check of het een CMS pagina is
    else if (pathParts.length >= 2) {
      const collection = pathParts[0];
      
      if (CONFIG.collections[collection]) {
        page.type = 'cms-item';
        page.collection = collection;
        page.category = CONFIG.collections[collection].type;
        page.slug = pathParts[pathParts.length - 1];
        
        // Haal item naam uit H1 of title
        const h1 = document.querySelector('h1');
        page.itemName = h1?.textContent?.trim() || page.title.split('|')[0].trim();
      }
    }
    // Collection list pagina's (resources, diensten zonder slug)
    else if (pathParts.length === 1 && CONFIG.collections[pathParts[0]]) {
      page.type = 'cms-list';
      page.collection = pathParts[0];
      page.category = CONFIG.collections[pathParts[0]].type + '-list';
    }
    
    // Detecteer Webflow CMS elementen
    page.hasCMSList = document.querySelector('.w-dyn-list') !== null;
    page.hasCMSItems = document.querySelectorAll('.w-dyn-item').length;
    
    // Tel formulieren
    page.formCount = document.querySelectorAll('form').length;
    
    log('Page analyzed:', page);
    return page;
  }

  // ============================================
  // VISITOR & SESSION
  // ============================================
  
  function getVisitor() {
    let visitor = storage.get('visitor');
    
    if (!visitor) {
      visitor = {
        id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).substr(2),
        firstVisit: new Date().toISOString(),
        visitCount: 0
      };
    }
    
    return visitor;
  }
  
  function getSession(visitor) {
    let session = storage.get('session');
    const now = Date.now();
    
    // Nieuwe sessie als timeout of niet bestaat
    if (!session || (now - session.lastActivity) > CONFIG.sessionTimeout) {
      visitor.visitCount++;
      visitor.lastVisit = new Date().toISOString();
      storage.set('visitor', visitor);
      
      session = {
        id: Date.now().toString(36),
        start: now,
        pageviews: 0,
        pages: []
      };
    }
    
    session.lastActivity = now;
    storage.set('session', session);
    
    return session;
  }
  
  function updateHistory(page, session) {
    // Voeg toe aan sessie history
    session.pages.push({
      path: page.path,
      type: page.type,
      category: page.category,
      time: Date.now()
    });
    session.pageviews++;
    storage.set('session', session);
    
    // Voeg toe aan totale history
    let history = storage.get('history') || { pages: [], total: 0 };
    history.pages.unshift({
      path: page.path,
      type: page.type,
      category: page.category,
      collection: page.collection,
      slug: page.slug
    });
    history.pages = history.pages.slice(0, 50); // Max 50
    history.total++;
    storage.set('history', history);
    
    return history;
  }
  
  function getBehaviorInsights(history, session) {
    const pages = history.pages;
    
    return {
      // Vorige pagina
      previousPage: session.pages.length > 1 
        ? session.pages[session.pages.length - 2].path 
        : null,
      
      // Bezochte categorieën
      hasSeenServices: pages.some(p => p.category === 'service' || p.category === 'service-list'),
      hasSeenResources: pages.some(p => p.category === 'content' || p.category === 'content-list'),
      hasSeenContact: pages.some(p => p.category === 'contact'),
      hasSeenAbout: pages.some(p => p.category === 'about'),
      
      // Engagement indicators
      servicesViewed: [...new Set(pages.filter(p => p.collection === 'diensten').map(p => p.slug))],
      resourcesViewed: [...new Set(pages.filter(p => p.collection === 'resources').map(p => p.slug))],
      
      // Journey stage (simpele logica)
      journeyStage: this.determineJourneyStage(pages, session)
    };
  }
  
  function determineJourneyStage(pages, session) {
    const hasSeenServices = pages.some(p => p.category === 'service');
    const hasSeenContact = pages.some(p => p.category === 'contact');
    const multipleVisits = session.pageviews > 3;
    
    if (hasSeenContact) return 'consideration';
    if (hasSeenServices && multipleVisits) return 'interest';
    if (hasSeenServices) return 'awareness';
    return 'discovery';
  }

  // ============================================
  // DATALAYER
  // ============================================
  
  const dataLayer = {
    init() {
      window.dataLayer = window.dataLayer || [];
    },
    
    push(event, data) {
      const payload = {
        event,
        ...data,
        _timestamp: new Date().toISOString(),
        _version: CONFIG.version
      };
      
      window.dataLayer.push(payload);
      log('DataLayer:', event, payload);
    }
  };

  // ============================================
  // PAGEVIEW EVENT
  // ============================================
  
  function pushPageview(page, visitor, session, history) {
    const behavior = getBehaviorInsights(history, session);
    
    dataLayer.push('page_view', {
      // Pagina
      page_path: page.path,
      page_title: page.title,
      page_type: page.type,
      page_category: page.category,
      
      // CMS specifiek
      cms_collection: page.collection,
      cms_slug: page.slug,
      cms_item_name: page.itemName,
      
      // SEO/Meta
      meta_description: page.description,
      og_title: page.ogTitle,
      
      // Bezoeker
      visitor_id: visitor.id,
      visitor_status: visitor.visitCount <= 1 ? 'new' : 'returning',
      visitor_count: visitor.visitCount,
      days_since_first: Math.floor((Date.now() - new Date(visitor.firstVisit)) / 86400000),
      
      // Sessie
      session_id: session.id,
      session_pageviews: session.pageviews,
      
      // Gedrag/Journey
      previous_page: behavior.previousPage,
      has_seen_services: behavior.hasSeenServices,
      has_seen_resources: behavior.hasSeenResources,
      has_seen_contact: behavior.hasSeenContact,
      journey_stage: behavior.journeyStage,
      services_viewed_count: behavior.servicesViewed.length,
      resources_viewed_count: behavior.resourcesViewed.length
    });
  }

  // ============================================
  // EVENT TRACKING
  // ============================================
  
  function setupTracking(page) {
    // ---- SCROLL TRACKING ----
    const scrollReached = new Set();
    let ticking = false;
    
    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      
      requestAnimationFrame(() => {
        const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
        if (scrollHeight <= 0) { ticking = false; return; }
        
        const percent = Math.round((window.scrollY / scrollHeight) * 100);
        
        CONFIG.scrollMilestones.forEach(milestone => {
          if (percent >= milestone && !scrollReached.has(milestone)) {
            scrollReached.add(milestone);
            dataLayer.push('scroll', {
              scroll_depth: milestone,
              page_path: page.path,
              page_type: page.type
            });
          }
        });
        
        ticking = false;
      });
    }, { passive: true });
    
    // ---- TIME ON PAGE ----
    CONFIG.timeMilestones.forEach(seconds => {
      setTimeout(() => {
        dataLayer.push('engaged_time', {
          seconds: seconds,
          page_path: page.path,
          page_type: page.type
        });
      }, seconds * 1000);
    });
    
    // ---- CTA & IMPORTANT CLICKS ----
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a');
      const button = e.target.closest('button, .w-button, [role="button"]');
      
      if (link) {
        const href = link.href || '';
        const text = link.textContent?.trim().substring(0, 80);
        
        // Telefoon
        if (href.startsWith('tel:')) {
          dataLayer.push('contact_click', {
            click_type: 'phone',
            click_value: href.replace('tel:', ''),
            page_path: page.path
          });
          return;
        }
        
        // Email
        if (href.startsWith('mailto:')) {
          dataLayer.push('contact_click', {
            click_type: 'email',
            click_value: href.replace('mailto:', '').split('?')[0],
            page_path: page.path
          });
          return;
        }
        
        // CTA detectie (buttons, hero links, etc.)
        const isCTA = link.classList.contains('w-button') ||
                     link.classList.contains('button') ||
                     link.closest('.hero, .cta, [class*="cta"], [class*="button"]');
        
        if (isCTA) {
          // Bepaal CTA type op basis van href
          let ctaType = 'general';
          if (href.includes('contact')) ctaType = 'contact';
          else if (href.includes('dienst')) ctaType = 'service';
          else if (href.includes('resource') || href.includes('blog')) ctaType = 'content';
          else if (href.includes('offerte') || href.includes('demo')) ctaType = 'conversion';
          
          dataLayer.push('cta_click', {
            cta_text: text,
            cta_url: href,
            cta_type: ctaType,
            page_path: page.path,
            page_type: page.type
          });
          return;
        }
        
        // Navigatie naar dienst of resource (interessant voor journey)
        if (href.includes('/diensten/') || href.includes('/resources/')) {
          const targetCollection = href.includes('/diensten/') ? 'diensten' : 'resources';
          const targetSlug = href.split('/').pop();
          
          dataLayer.push('content_click', {
            target_collection: targetCollection,
            target_slug: targetSlug,
            click_text: text,
            page_path: page.path
          });
        }
      }
      
      // Standalone buttons (niet-links)
      if (button && !link) {
        dataLayer.push('button_click', {
          button_text: button.textContent?.trim().substring(0, 80),
          button_id: button.id || null,
          page_path: page.path
        });
      }
    });
    
    // ---- FORM TRACKING ----
    document.querySelectorAll('form').forEach((form, i) => {
      const formId = form.id || form.getAttribute('data-name') || `form-${i}`;
      const formName = form.getAttribute('data-name') || form.getAttribute('name') || `Form ${i + 1}`;
      let started = false;
      
      // Form start
      form.addEventListener('focusin', () => {
        if (started) return;
        started = true;
        
        dataLayer.push('form_start', {
          form_id: formId,
          form_name: formName,
          page_path: page.path
        });
      }, { once: true });
      
      // Form submit
      form.addEventListener('submit', () => {
        // Check of dit eerste submit is
        const submitted = storage.get('forms_submitted') || [];
        const isFirst = !submitted.includes(formId);
        
        if (isFirst) {
          submitted.push(formId);
          storage.set('forms_submitted', submitted);
        }
        
        dataLayer.push('form_submit', {
          form_id: formId,
          form_name: formName,
          is_first_submit: isFirst,
          page_path: page.path,
          page_type: page.type
        });
      });
    });
    
    // Webflow success message
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((m) => {
        m.addedNodes.forEach((node) => {
          if (node.nodeType === 1 && node.classList?.contains('w-form-done')) {
            dataLayer.push('form_success', {
              page_path: page.path
            });
          }
        });
      });
    });
    
    document.querySelectorAll('.w-form').forEach(wrapper => {
      observer.observe(wrapper, { childList: true, subtree: true });
    });
  }

  // ============================================
  // INIT
  // ============================================
  
  function init() {
    log('Initializing Fendix Tracking v' + CONFIG.version);
    
    dataLayer.init();
    
    const page = analyzePage();
    const visitor = getVisitor();
    const session = getSession(visitor);
    const history = updateHistory(page, session);
    
    pushPageview(page, visitor, session, history);
    setupTracking(page);
    
    // Debug helpers
    if (CONFIG.debug) {
      window.FendixTrack = {
        page: () => analyzePage(),
        visitor: () => storage.get('visitor'),
        session: () => storage.get('session'),
        history: () => storage.get('history'),
        dataLayer: () => window.dataLayer,
        clearAll: () => {
          Object.keys(localStorage)
            .filter(k => k.startsWith(CONFIG.storagePrefix))
            .forEach(k => localStorage.removeItem(k));
          log('Storage cleared');
        }
      };
      log('Debug helpers available: window.FendixTrack');
    }
    
    log('✅ Tracking initialized');
  }
  
  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
