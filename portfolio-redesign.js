(() => {
  const hydrateImage = image => {
    if (!(image instanceof HTMLImageElement) || !image.dataset.src) return;
    image.src = image.dataset.src;
    delete image.dataset.src;
  };
  const deferredImages = [...document.querySelectorAll('img[data-src]')];
  if ('IntersectionObserver' in window) {
    const imageObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        hydrateImage(entry.target);
        imageObserver.unobserve(entry.target);
      });
    }, {rootMargin:'600px 0px'});
    deferredImages.forEach(image => imageObserver.observe(image));
  } else {
    deferredImages.forEach(hydrateImage);
  }

  const viewportMeta = document.querySelector('meta[name="viewport"]');
  if (viewportMeta) {
    viewportMeta.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover');
  }
  ['gesturestart','gesturechange','gestureend'].forEach(type => {
    document.addEventListener(type, event => event.preventDefault(), {passive:false});
  });
  document.addEventListener('touchmove', event => {
    if (event.touches.length > 1) event.preventDefault();
  }, {passive:false});

  /**
   * WebGL screen distortion adapted from Eric Leong's fisheye.js.
   * https://github.com/ericleong/fisheye.js — MIT License, copyright Eric Leong.
   */
  class CRTScreenRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      const options = {alpha:true,depth:false,antialias:true,preserveDrawingBuffer:false};
      this.gl = canvas.getContext('webgl', options) || canvas.getContext('experimental-webgl', options);
      if (!this.gl) return;
      const gl = this.gl;
      const vertex = 'attribute vec2 p;attribute vec2 t;varying highp vec2 v;void main(){gl_Position=vec4(p,0.,1.);v=t;}';
      const fragment = `precision mediump float;varying highp vec2 v;uniform sampler2D image;uniform vec3 distortion;uniform float ratio;
        float scaleFor(float d,float limit){return d>=0.0?1.0+d*limit:1.0/(1.0-d*limit);}
        void main(){float rsq;float limit;if(ratio<1.0){rsq=pow((v.x-.5)*ratio,2.0)+pow(v.y-.5,2.0);limit=(pow(.5*ratio,2.0)+pow(.5,2.0))/(2.0/ratio);}else{rsq=pow(v.x-.5,2.0)+pow((v.y-.5)/ratio,2.0);limit=(pow(.5,2.0)+pow(.5/ratio,2.0))/(2.0*ratio);}vec3 s=vec3(scaleFor(distortion.r,limit),scaleFor(distortion.g,limit),scaleFor(distortion.b,limit));vec2 r=vec2(.5+(v.x-.5)*(1.0+distortion.r*rsq)/s.r,.5+(v.y-.5)*(1.0+distortion.r*rsq)/s.r);vec2 g=vec2(.5+(v.x-.5)*(1.0+distortion.g*rsq)/s.g,.5+(v.y-.5)*(1.0+distortion.g*rsq)/s.g);vec2 b=vec2(.5+(v.x-.5)*(1.0+distortion.b*rsq)/s.b,.5+(v.y-.5)*(1.0+distortion.b*rsq)/s.b);vec4 c=vec4(0.,0.,0.,1.);if(r.x>=0.&&r.x<=1.&&r.y>=0.&&r.y<=1.)c.r=texture2D(image,r).r;if(g.x>=0.&&g.x<=1.&&g.y>=0.&&g.y<=1.)c.g=texture2D(image,g).g;if(b.x>=0.&&b.x<=1.&&b.y>=0.&&b.y<=1.)c.b=texture2D(image,b).b;gl_FragColor=c;}`;
      const shader = (type, source) => {
        const item = gl.createShader(type);
        gl.shaderSource(item, source);
        gl.compileShader(item);
        if (!gl.getShaderParameter(item, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(item));
        return item;
      };
      this.program = gl.createProgram();
      gl.attachShader(this.program, shader(gl.VERTEX_SHADER, vertex));
      gl.attachShader(this.program, shader(gl.FRAGMENT_SHADER, fragment));
      gl.linkProgram(this.program);
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program));
      this.p = gl.getAttribLocation(this.program, 'p');
      this.t = gl.getAttribLocation(this.program, 't');
      this.uDistortion = gl.getUniformLocation(this.program, 'distortion');
      this.uRatio = gl.getUniformLocation(this.program, 'ratio');
      this.uImage = gl.getUniformLocation(this.program, 'image');
      this.vertexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
      this.textureBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.textureBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,1,1,1,0,0,1,0]), gl.STATIC_DRAW);
      this.texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.values = [-.42,-.36,-.3];
    }
    setDistortion(red, green, blue) { this.values = [red,green,blue]; }
    draw(source) {
      const gl = this.gl;
      if (!gl) {
        const context = this.canvas.getContext('2d');
        context?.drawImage(source,0,0,this.canvas.width,this.canvas.height);
        return;
      }
      const density = Math.min(2,window.devicePixelRatio||1);
      this.canvas.width = Math.max(1,Math.round(this.canvas.clientWidth*density));
      this.canvas.height = Math.max(1,Math.round(this.canvas.clientHeight*density));
      gl.viewport(0,0,this.canvas.width,this.canvas.height);
      gl.useProgram(this.program);
      gl.bindBuffer(gl.ARRAY_BUFFER,this.vertexBuffer);gl.enableVertexAttribArray(this.p);gl.vertexAttribPointer(this.p,2,gl.FLOAT,false,0,0);
      gl.bindBuffer(gl.ARRAY_BUFFER,this.textureBuffer);gl.enableVertexAttribArray(this.t);gl.vertexAttribPointer(this.t,2,gl.FLOAT,false,0,0);
      gl.uniform3fv(this.uDistortion,this.values);gl.uniform1f(this.uRatio,source.width/source.height);gl.uniform1i(this.uImage,0);
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    }
  }

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hero = document.querySelector('#hero');
  const introGrid = hero?.querySelector('.hero-intro-grid');
  const about = hero?.querySelector('.hero-about');
  const logoWrap = introGrid?.querySelector('.hero-logo-wrap');
  const photoCard = introGrid?.querySelector('.hero-photo-card');
  const aboutText = about?.querySelector('.hero-about-text');

  if (hero && introGrid && about && logoWrap && photoCard && aboutText) {
    logoWrap.classList.add('hero-centered-logo');
    aboutText.classList.add('hero-profile-copy');

    const ruBio = [...aboutText.querySelectorAll(':scope > p[data-ru]')];
    const enBio = [...aboutText.querySelectorAll(':scope > p[data-en]')];
    if (ruBio[0]) ruBio[0].textContent = 'Я — графический дизайнер и 3D-художник, который превращает идеи в цельные визуальные системы. Разрабатываю айдентику, упаковку, иллюстрации, плакаты и объекты — от исследования и концепции до готовых макетов и производства.';
    if (ruBio[1]) ruBio[1].textContent = 'Соединяю точную работу с формой, типографикой и материалом с экспериментальным подходом. Сотрудничаю с брендами, агентствами и независимыми командами; открыт к коммерческим проектам и коллаборациям.';
    if (enBio[0]) enBio[0].textContent = 'I am a graphic designer and 3D artist who turns ideas into cohesive visual systems. I develop identities, packaging, illustrations, posters, and objects — from research and concept through production-ready artwork and fabrication.';
    if (enBio[1]) enBio[1].textContent = 'I combine precise work with form, typography, and materials with an experimental approach. I collaborate with brands, agencies, and independent teams, and I am open to commissions and creative collaborations.';

    const disciplines = document.createElement('p');
    disciplines.className = 'hero-disciplines-inline';
    disciplines.innerHTML = '<span data-ru><strong>Рабочие инструменты.</strong> Adobe Photoshop, Illustrator, InDesign и CorelDRAW — для графики, айдентики и полиграфии; Figma — для интерфейсов и визуальных систем; Nomad Sculpt и Womp 3D — для объёмной формы и 3D; Procreate — для иллюстрации и эскизов. Использую ChatGPT и Claude как ИИ-инструменты для исследования, разработки концепций и ускорения рабочих процессов.</span><span data-en><strong>Tools.</strong> Adobe Photoshop, Illustrator, InDesign, and CorelDRAW for graphics, identity, and print; Figma for interfaces and visual systems; Nomad Sculpt and Womp 3D for sculpting and 3D form; Procreate for illustration and sketching. I use ChatGPT and Claude as AI tools for research, concept development, and workflow acceleration.</span>';
    aboutText.append(disciplines);

    const profile = document.createElement('div');
    profile.className = 'hero-profile-grid';
    profile.id = 'about';
    profile.append(photoCard, aboutText);

    hero.insertBefore(logoWrap, introGrid);
    hero.insertBefore(profile, introGrid);
    introGrid.remove();
    about.remove();
  }

  const profileGrid = document.querySelector('.hero-profile-grid');
  const gritSection = document.querySelector('#ch6');
  if (profileGrid && gritSection) {
    hero?.classList.add('hero-logo-only');
    profileGrid.removeAttribute('id');
    const aboutSection = document.createElement('section');
    aboutSection.className = 'about-section';
    aboutSection.id = 'about';
    const aboutLabel = document.createElement('div');
    aboutLabel.className = 'about-section-label caps';
    aboutLabel.innerHTML = '<span data-ru>Обо мне</span><span data-en>About</span>';
    aboutSection.append(aboutLabel, profileGrid);
    gritSection.after(aboutSection);
  }

  const posterTitles = [
    ['Плакат «Lost Boy»', '“Lost Boy” poster'],
    ['Визуальный эксперимент в эстетике 2000-х', 'Visual experiment in a 2000s aesthetic'],
    ['Плакат «Дизайн» — исполни детскую мечту', '“Design” poster — fulfil your childhood dream'],
    ['Новогодний плакат для «Союзник»', 'New Year poster for Soyuznik'],
    ['Обложка музыкального журнала «GARM»', 'GARM music magazine cover'],
    ['Плакат «Выбери профессию будущего»', '“Choose the profession of the future” poster'],
    ['Плакат «The Last Chance»', '“The Last Chance” poster'],
    ['Типографический плакат с немецким текстом', 'Typographic poster with German copy']
  ];
  document.querySelectorAll('#ch5 .poster-item').forEach((item, index) => {
    const title = posterTitles[index];
    if (!title) return;
    const ru = item.querySelector('.poster-caption [data-ru]');
    const en = item.querySelector('.poster-caption [data-en]');
    const image = item.querySelector('img');
    if (ru) ru.textContent = title[0];
    if (en) en.textContent = title[1];
    if (image) image.alt = title[0];
  });

  const projectIds = ['ch5','ch1','ch2','ch3','ch4','ch6'];
  const projectSections = projectIds.map(id => document.getElementById(id)).filter(Boolean);
  if (projectSections.length) {
    const projectsGate = document.createElement('button');
    projectsGate.className = 'projects-gate';
    projectsGate.id = 'projects';
    projectsGate.type = 'button';
    projectsGate.setAttribute('aria-expanded', 'false');
    projectsGate.setAttribute('aria-controls', 'projects-shell');

    const projectsHint = document.createElement('span');
    projectsHint.className = 'projects-gate-hint mono';
    projectsHint.innerHTML = '<span data-ru>НАЖМИ МЕНЯ</span><span data-en>CLICK ME</span>';

    const projectsToggle = document.createElement('span');
    projectsToggle.className = 'projects-toggle';
    projectsToggle.innerHTML = '<span data-ru>ПРОЕКТЫ</span><span data-en>PROJECTS</span>';

    const projectsArrow = document.createElement('span');
    projectsArrow.className = 'projects-arrow';
    projectsArrow.setAttribute('aria-hidden', 'true');

    const projectsShell = document.createElement('div');
    projectsShell.className = 'projects-shell';
    projectsShell.id = 'projects-shell';
    projectsShell.hidden = true;

    projectsGate.append(projectsHint, projectsToggle, projectsArrow);
    projectSections[0].before(projectsGate);
    projectsGate.after(projectsShell);
    projectSections.forEach(section => projectsShell.append(section));

    let projectsCloseTimer = 0;
    projectsGate.addEventListener('click', () => {
      const open = projectsGate.getAttribute('aria-expanded') !== 'true';
      projectsGate.setAttribute('aria-expanded', String(open));
      window.clearTimeout(projectsCloseTimer);
      document.body.classList.toggle('projects-open', open);
      if (open) {
        projectsShell.hidden = false;
        requestAnimationFrame(() => {
          projectsShell.classList.add('is-open');
          window.setTimeout(() => projectSections[0].scrollIntoView({behavior:'smooth', block:'start'}), 150);
        });
      } else {
        projectsShell.classList.remove('is-open');
        projectsCloseTimer = window.setTimeout(() => { projectsShell.hidden = true; }, 300);
      }
    });

    document.querySelectorAll('.site-nav a[href="#ch5"]').forEach(link => link.setAttribute('href', '#projects'));
  }

  const contact = document.querySelector('footer.contact');
  if (contact) {
    contact.id = 'contact-panel';
    contact.setAttribute('aria-label', 'Контакты');
    const contactArt = document.createElement('img');
    contactArt.className = 'contact-organic-art';
    contactArt.loading = 'lazy';
    contactArt.decoding = 'async';
    contactArt.src = 'contact-organic-cutout.webp';
    contactArt.alt = '';
    contactArt.draggable = false;
    contactArt.setAttribute('aria-hidden', 'true');
    contact.append(contactArt);
    const spacer = document.createElement('div');
    spacer.className = 'contact-reveal-spacer';
    spacer.id = 'contact';
    spacer.setAttribute('aria-hidden', 'true');
    contact.before(spacer);
    if ('IntersectionObserver' in window) {
      const contactObserver = new IntersectionObserver(entries => {
        document.body.classList.toggle('contact-revealed', entries.some(entry => entry.isIntersecting));
      }, {threshold:.04});
      contactObserver.observe(spacer);
    } else {
      document.body.classList.add('contact-revealed');
    }
  }

  const sourceLogo = document.querySelector('.hero-centered-logo .hero-logo');
  const firstHeader = document.querySelector('header.top');
  let introShell = null;

  if (firstHeader) {
    firstHeader.querySelector('.logo-img')?.remove();

    const headerTrigger = document.createElement('div');
    headerTrigger.className = 'header-trigger';
    headerTrigger.setAttribute('aria-hidden', 'true');
    document.body.append(headerTrigger);

    let headerHideTimer = 0;
    let headerVisibleUntil = 0;
    let pointerInHeader = false;

    const hideHeaderWhenReady = () => {
      window.clearTimeout(headerHideTimer);
      if (pointerInHeader) return;
      const delay = Math.max(0, headerVisibleUntil - Date.now());
      headerHideTimer = window.setTimeout(() => {
        if (!pointerInHeader) document.body.classList.remove('header-visible');
      }, delay);
    };
    const showHeader = () => {
      document.body.classList.add('header-visible');
      headerVisibleUntil = Date.now() + 5000;
      hideHeaderWhenReady();
    };

    headerTrigger.addEventListener('pointerenter', showHeader);
    firstHeader.addEventListener('pointerenter', () => {
      pointerInHeader = true;
      window.clearTimeout(headerHideTimer);
    });
    firstHeader.addEventListener('pointerleave', () => {
      pointerInHeader = false;
      hideHeaderWhenReady();
    });

    if (window.matchMedia('(pointer:coarse)').matches) {
      document.body.classList.add('header-visible');
    }
  }

  if (!reduceMotion && sourceLogo && firstHeader) {
    introShell = document.createElement('section');
    introShell.className = 'crt-intro-shell';
    introShell.setAttribute('aria-label', 'Вступительная анимация');

    const stage = document.createElement('div');
    stage.className = 'crt-intro-stage';
    const scene = document.createElement('div');
    scene.className = 'crt-monitor-scene';

    const monitor = document.createElement('img');
    monitor.className = 'crt-monitor-image';
    monitor.src = 'crt-monitor-screen-transparent-4k.webp';
    monitor.alt = '';
    monitor.setAttribute('aria-hidden', 'true');

    const screen = document.createElement('div');
    screen.className = 'crt-screen';
    const screenContent = document.createElement('div');
    screenContent.className = 'crt-screen-content';
    const fisheyeCanvas = document.createElement('canvas');
    fisheyeCanvas.className = 'crt-fisheye-canvas';
    fisheyeCanvas.setAttribute('aria-label', 'Миниатюрный вид сайта внутри экрана');

    const noise = document.createElement('div');
    noise.className = 'crt-noise';
    const scanlines = document.createElement('div');
    scanlines.className = 'crt-scanlines';
    const vignette = document.createElement('div');
    vignette.className = 'crt-vignette';
    const switchNoise = document.createElement('div');
    switchNoise.className = 'crt-switch-noise';
    switchNoise.setAttribute('aria-hidden', 'true');
    const flash = document.createElement('div');
    flash.className = 'crt-flash';

    const progress = document.createElement('div');
    progress.className = 'crt-progress';
    progress.innerHTML = '<span data-ru>Прокрутите или нажмите на экран</span><span data-en>Scroll or click the screen</span>';
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'crt-skip';
    skip.setAttribute('aria-label', 'Пропустить вступление');

    const monitorControls = document.createElement('div');
    monitorControls.className = 'crt-monitor-controls';
    monitorControls.setAttribute('aria-label', 'Кнопки монитора');
    const controlLabels = [
      'Показать сайт на экране',
      'Показать портрет',
      'Показать анимацию со спящей собакой',
      'Показать фотографию пейзажа',
      'Включить или выключить экран'
    ];
    const monitorButtons = controlLabels.map((label, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `crt-monitor-button crt-monitor-button--${index + 1}`;
      button.setAttribute('aria-label', label);
      button.dataset.crtControl = String(index + 1);
      monitorControls.append(button);
      return button;
    });

    screenContent.append(fisheyeCanvas, noise, scanlines, vignette, switchNoise);
    screen.append(screenContent);
    scene.append(screen, monitor, skip, monitorControls);
    stage.append(scene, flash, progress);
    introShell.append(stage);
    document.body.insertBefore(introShell, firstHeader);
    document.body.classList.add('has-crt-intro', 'intro-active');

    const miniSite = document.createElement('canvas');
    miniSite.width = 1100;
    miniSite.height = 860;
    const miniContext = miniSite.getContext('2d');
    const portraitSource = document.querySelector('.hero-profile-grid .hero-photo');
    const channelImages = [null, new Image(), new Image(), new Image()];
    const channelSources = [null, 'intro-assets/pavel-twin.webp', 'intro-assets/sleeping-dog.webp', 'intro-assets/altai-landscape.webp'];
    channelImages.slice(1).forEach(image => { image.decoding = 'async'; });
    let activeChannel = 0;
    let screenPowered = true;
    let gifAnimationFrame = 0;
    let channelSwitchTimer = 0;
    let channelNoiseTimer = 0;
    let screenRenderer = null;
    try { screenRenderer = new CRTScreenRenderer(fisheyeCanvas); } catch (error) { console.warn('CRT screen fallback', error); }

    const drawContained = (context, image, x, y, width, height) => {
      if (!image?.naturalWidth || !image?.naturalHeight) return;
      const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
      const drawWidth = image.naturalWidth * scale;
      const drawHeight = image.naturalHeight * scale;
      context.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
    };

    const drawCover = (context, image, x, y, width, height) => {
      if (!image?.naturalWidth || !image?.naturalHeight) return;
      const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
      const sourceWidth = width / scale;
      const sourceHeight = height / scale;
      const sourceX = (image.naturalWidth - sourceWidth) / 2;
      const sourceY = (image.naturalHeight - sourceHeight) / 2;
      context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
    };

    const drawMiniToScreen = () => {
      if (screenRenderer) {
        screenRenderer.draw(miniSite);
        return;
      }
      const density = Math.min(2, window.devicePixelRatio || 1);
      fisheyeCanvas.width = Math.max(1, Math.round(fisheyeCanvas.clientWidth * density));
      fisheyeCanvas.height = Math.max(1, Math.round(fisheyeCanvas.clientHeight * density));
      fisheyeCanvas.getContext('2d')?.drawImage(miniSite, 0, 0, fisheyeCanvas.width, fisheyeCanvas.height);
    };

    const paintMiniSite = () => {
      const context = miniContext;
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, miniSite.width, miniSite.height);
      context.strokeStyle = 'rgba(17,17,16,.22)';
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(0, 70);
      context.lineTo(miniSite.width, 70);
      context.stroke();

      context.fillStyle = '#111110';
      context.font = '500 16px Arial, sans-serif';
      context.fillText('PES', 48, 44);
      context.font = '500 12px monospace';
      context.fillStyle = '#65655f';
      context.fillText('РАБОТЫ     ОБО МНЕ     КОНТАКТЫ', 688, 43);

      drawContained(context, sourceLogo, 138, 112, 824, 250);
      context.strokeStyle = 'rgba(17,17,16,.16)';
      context.beginPath();
      context.moveTo(54, 408);
      context.lineTo(1046, 408);
      context.stroke();

      drawCover(context, portraitSource, 54, 450, 318, 356);
      context.fillStyle = '#111110';
      context.font = '500 42px Arial, sans-serif';
      context.fillText('Павел, он же PЁS', 432, 512);
      context.fillStyle = '#666660';
      context.font = '400 19px Arial, sans-serif';
      const lines = [
        'Графический дизайнер и 3D-художник.',
        'Создаю айдентику, упаковку, иллюстрации',
        'и мерч — от концепции до готового объекта.',
        '',
        'Брендинг · инфографика · 3D · полиграфия',
        'иллюстрация · плакаты · эксперименты'
      ];
      lines.forEach((line, index) => context.fillText(line, 432, 564 + index * 35));
      drawMiniToScreen();
    };

    const paintMediaChannel = image => {
      const context = miniContext;
      context.fillStyle = '#000';
      context.fillRect(0, 0, miniSite.width, miniSite.height);
      if (image?.naturalWidth && image?.naturalHeight) {
        drawCover(context, image, 0, 0, miniSite.width, miniSite.height);
      }
      drawMiniToScreen();
    };

    const stopGifPlayback = () => {
      if (gifAnimationFrame) cancelAnimationFrame(gifAnimationFrame);
      gifAnimationFrame = 0;
    };

    const startGifPlayback = () => {
      stopGifPlayback();
      let previousPaint = 0;
      const drawFrame = now => {
        if (activeChannel !== 2 || !screenPowered || !document.body.classList.contains('intro-active')) {
          gifAnimationFrame = 0;
          return;
        }
        if (now - previousPaint >= 80) {
          paintMediaChannel(channelImages[2]);
          previousPaint = now;
        }
        gifAnimationFrame = requestAnimationFrame(drawFrame);
      };
      gifAnimationFrame = requestAnimationFrame(drawFrame);
    };

    const paintActiveChannel = () => {
      if (activeChannel === 0) {
        paintMiniSite();
        stopGifPlayback();
        return;
      }
      const image = channelImages[activeChannel];
      if (!image.src) {
        paintMediaChannel(null);
        image.src = channelSources[activeChannel];
        imageReady(image).then(() => {
          if (activeChannel === channelImages.indexOf(image)) paintActiveChannel();
        });
        return;
      }
      paintMediaChannel(image);
      if (activeChannel === 2) startGifPlayback();
      else stopGifPlayback();
    };

    const imageReady = image => {
      if (!image || image.complete) return Promise.resolve();
      if (typeof image.decode === 'function') return image.decode().catch(() => undefined);
      return new Promise(resolve => image.addEventListener('load', resolve, {once:true}));
    };
    Promise.all([imageReady(sourceLogo), imageReady(portraitSource), document.fonts?.ready || Promise.resolve()]).then(() => {
      if (activeChannel === 0) paintMiniSite();
    });

    const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
    const smoothstep = (edge0, edge1, value) => {
      const x = clamp((value - edge0) / (edge1 - edge0));
      return x * x * (3 - 2 * x);
    };

    const syncMonitorControls = () => {
      monitorButtons.slice(0, 4).forEach((button, index) => {
        const selected = screenPowered && activeChannel === index;
        button.classList.toggle('is-active', selected);
        button.setAttribute('aria-pressed', String(selected));
      });
      monitorButtons[4].classList.toggle('is-active', screenPowered);
      monitorButtons[4].setAttribute('aria-pressed', String(screenPowered));
    };

    const switchChannel = nextChannel => {
      if (!screenPowered || nextChannel === activeChannel || nextChannel < 0 || nextChannel > 3) return;
      window.clearTimeout(channelSwitchTimer);
      window.clearTimeout(channelNoiseTimer);
      stopGifPlayback();
      screen.classList.remove('is-channel-switching');
      void screen.offsetWidth;
      screen.classList.add('is-channel-switching');
      channelSwitchTimer = window.setTimeout(() => {
        activeChannel = nextChannel;
        paintActiveChannel();
        syncMonitorControls();
      }, 245);
      channelNoiseTimer = window.setTimeout(() => screen.classList.remove('is-channel-switching'), 510);
    };

    const toggleScreenPower = () => {
      window.clearTimeout(channelSwitchTimer);
      window.clearTimeout(channelNoiseTimer);
      screen.classList.remove('is-channel-switching');
      screenContent.getAnimations().forEach(animation => animation.cancel());
      screenPowered = !screenPowered;
      screen.classList.toggle('is-powered-off', !screenPowered);
      syncMonitorControls();

      if (!screenPowered) {
        stopGifPlayback();
        if (!screenContent.animate) {
          screenContent.style.display = 'none';
          return;
        }
        screenContent.animate([
          {width:'100%', height:'100%', background:'#fff'},
          {width:'100%', height:'2px', background:'#fff', offset:.56},
          {width:'0', height:'0', background:'#fff'}
        ], {duration:400, easing:'cubic-bezier(.4,0,.2,1)', fill:'forwards'});
        return;
      }

      screen.classList.add('is-powered-off');
      screenContent.style.display = '';
      paintActiveChannel();
      if (!screenContent.animate) {
        screen.classList.remove('is-powered-off');
        return;
      }
      const powerOnAnimation = screenContent.animate([
        {width:'0', height:'0', background:'#fff'},
        {width:'100%', height:'2px', background:'#fff', offset:.44},
        {width:'100%', height:'100%', background:'transparent'}
      ], {duration:430, easing:'cubic-bezier(.2,.7,.2,1)', fill:'forwards'});
      powerOnAnimation.finished.then(() => {
        if (screenPowered) screen.classList.remove('is-powered-off');
      }).catch(() => undefined);
    };

    monitorButtons.forEach((button, index) => {
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        if (index < 4) switchChannel(index);
        else toggleScreenPower();
      });
    });
    syncMonitorControls();

    let ticking = false;
    let transitionCommitted = false;
    let introZoom = .82;
    let introZoomTarget = .82;

    const finishIntro = () => {
      stopGifPlayback();
      stage.style.opacity = '0';
      introShell.style.display = 'none';
      document.body.classList.remove('intro-active', 'has-crt-intro', 'portal-committing');
      document.documentElement.style.setProperty('--portal-rgb', '0px');
      window.scrollTo(0, 0);
    };

    const commitTransition = (animated = true) => {
      if (transitionCommitted) return;
      transitionCommitted = true;
      document.body.classList.add('portal-committing');

      if (!animated || !stage.animate) {
        finishIntro();
        return;
      }

      const currentTransform = scene.style.transform || 'translate3d(0,0,0) scale(.82)';
      scene.animate([
        {filter:'brightness(1) contrast(1)',transform:currentTransform},
        {filter:'brightness(1.9) contrast(1.18)',transform:'translate3d(0,0,0) scale(2.35)',offset:.46},
        {filter:'brightness(3.2) contrast(.75) blur(2px)',transform:'translate3d(0,0,0) scale(3.12)'}
      ], {duration:560,easing:'cubic-bezier(.25,.7,.2,1)',fill:'forwards'});
      flash.animate([
        {opacity:0},
        {opacity:.96,offset:.48},
        {opacity:1,offset:.64},
        {opacity:1}
      ], {duration:560,easing:'ease-out',fill:'forwards'});
      window.setTimeout(finishIntro, 570);
    };

    const paintIntro = () => {
      if (transitionCommitted) {
        ticking = false;
        return;
      }
      introZoom += (introZoomTarget - introZoom) * .16;
      if (Math.abs(introZoomTarget - introZoom) < .0005) introZoom = introZoomTarget;
      const p = clamp((introZoom - .82) / 2.08);

      scene.style.transform = `translate3d(0,0,0) scale(${introZoom})`;
      scene.style.filter = 'none';
      screen.style.transform = 'none';
      screenRenderer?.setDistortion(.56 + p * .3, .49 + p * .25, .42 + p * .2);
      drawMiniToScreen();
      noise.style.opacity = String(.13 + p * .2);
      scanlines.style.opacity = String(.22 + p * .18);
      flash.style.opacity = '0';
      progress.style.opacity = String(1 - smoothstep(.12, .38, p));
      stage.style.opacity = '1';
      if (introZoom >= 2.88) {
        commitTransition(true);
        ticking = false;
        return;
      }
      if (Math.abs(introZoomTarget - introZoom) > .0005) {
        requestAnimationFrame(paintIntro);
      } else {
        ticking = false;
      }
    };

    const requestPaint = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(paintIntro);
      }
    };

    window.addEventListener('resize', requestPaint, {passive:true});
    const changeIntroZoom = delta => {
      const factor = Math.exp(delta * .00135);
      introZoomTarget = clamp(introZoomTarget * factor, .025, 2.94);
      requestPaint();
    };
    window.addEventListener('wheel', event => {
      if (!document.body.classList.contains('intro-active') || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      changeIntroZoom(event.deltaY);
    }, {passive:false,capture:true});

    let introTouchY = null;
    stage.addEventListener('touchstart', event => {
      introTouchY = event.touches[0]?.clientY ?? null;
    }, {passive:true});
    stage.addEventListener('touchmove', event => {
      if (introTouchY === null) return;
      const nextY = event.touches[0]?.clientY;
      if (nextY === undefined) return;
      event.preventDefault();
      changeIntroZoom((introTouchY - nextY) * 2.1);
      introTouchY = nextY;
    }, {passive:false});
    stage.addEventListener('touchend', () => { introTouchY = null; }, {passive:true});

    skip.addEventListener('click', () => commitTransition(true));

    const returnToIntro = document.querySelector('footer.contact .foot-note');
    if (returnToIntro) {
      returnToIntro.dataset.returnIntro = '';
      returnToIntro.setAttribute('role', 'button');
      returnToIntro.setAttribute('tabindex', '0');
      returnToIntro.setAttribute('aria-label', 'Вернуться на стартовый экран');
      const restartIntro = () => {
        transitionCommitted = false;
        introZoom = .82;
        introZoomTarget = .82;
        scene.getAnimations().forEach(animation => animation.cancel());
        flash.getAnimations().forEach(animation => animation.cancel());
        introShell.style.display = '';
        stage.style.opacity = '1';
        stage.style.filter = 'none';
        flash.style.opacity = '0';
        scene.style.transform = 'translate3d(0,0,0) scale(.82)';
        document.body.classList.remove('contact-revealed', 'header-visible', 'portal-committing');
        document.body.classList.add('has-crt-intro', 'intro-active');
        window.scrollTo(0, 0);
        paintActiveChannel();
        requestPaint();
      };
      returnToIntro.addEventListener('click', restartIntro);
      returnToIntro.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        restartIntro();
      });
    }
    paintIntro();
  }

  const enhancedGritSection = document.querySelector('#ch6');
  if (enhancedGritSection) {
    const gritContent = enhancedGritSection.querySelector('#grit-content');
    const gritLogo = enhancedGritSection.querySelector('.grit-logo-switch');
    const legacyTopToggle = enhancedGritSection.querySelector('.grit-intro > .grit-toggle');
    let closeTimer = 0;

    if (gritContent && gritLogo) {
      legacyTopToggle?.remove();
      gritLogo.setAttribute('role', 'button');
      gritLogo.setAttribute('tabindex', '0');
      gritLogo.setAttribute('aria-controls', 'grit-content');
      gritLogo.setAttribute('aria-expanded', String(!gritContent.hidden));
      gritLogo.setAttribute('aria-label', 'Открыть или свернуть раздел 1000GRIT');

      const setGritOpen = (open, scrollAfterClose = false) => {
        window.clearTimeout(closeTimer);
        gritLogo.classList.toggle('is-open', open);
        gritLogo.setAttribute('aria-expanded', String(open));
        enhancedGritSection.classList.toggle('is-grit-open', open);
        gritContent.classList.remove('grit-content--entering', 'grit-content--leaving');

        if (open) {
          gritContent.hidden = false;
          requestAnimationFrame(() => gritContent.classList.add('grit-content--entering'));
          closeTimer = window.setTimeout(() => gritContent.classList.remove('grit-content--entering'), 380);
          window.setTimeout(() => window.scrollBy({top:38, behavior:reduceMotion ? 'auto' : 'smooth'}), reduceMotion ? 0 : 120);
          return;
        }

        if (gritContent.hidden) return;
        gritContent.classList.add('grit-content--leaving');
        closeTimer = window.setTimeout(() => {
          gritContent.hidden = true;
          gritContent.classList.remove('grit-content--leaving');
          if (scrollAfterClose) gritLogo.scrollIntoView({behavior:reduceMotion ? 'auto' : 'smooth', block:'center'});
        }, reduceMotion ? 0 : 230);
      };

      const toggleFromLogo = () => setGritOpen(gritContent.hidden);
      gritLogo.addEventListener('click', toggleFromLogo);
      gritLogo.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        toggleFromLogo();
      });

      const legacyBottomClose = enhancedGritSection.querySelector('[data-grit-close]');
      if (legacyBottomClose) {
        const bottomClose = legacyBottomClose.cloneNode(false);
        bottomClose.className = legacyBottomClose.className;
        bottomClose.type = 'button';
        bottomClose.dataset.gritClose = '';
        bottomClose.setAttribute('aria-label', 'Свернуть раздел 1000GRIT');
        const label = document.createElement('span');
        const labelRu = document.createElement('span');
        const labelEn = document.createElement('span');
        labelRu.dataset.ru = '';
        labelEn.dataset.en = '';
        labelRu.textContent = 'СВЕРНУТЬ РАЗДЕЛ / 1000GRIT';
        labelEn.textContent = 'CLOSE SECTION / 1000GRIT';
        label.append(labelRu, labelEn);
        const mark = document.createElement('span');
        mark.className = 'grit-close-mark';
        mark.setAttribute('aria-hidden', 'true');
        mark.textContent = '↑';
        bottomClose.append(label, mark);
        legacyBottomClose.replaceWith(bottomClose);
        bottomClose.addEventListener('click', () => setGritOpen(false, true));
      }
    }

    const processAssets = [
      ['idea', 'grit-assets/step-idea.webp', 'Текстовая разработка идеи'],
      ['sketch', 'grit-assets/step-sketch.webp', 'Эскиз персонажей'],
      ['model', 'grit-assets/step-model.webp', 'Разработка модели рядом с эскизом'],
      ['print', 'grit-assets/step-print.webp', 'Две тестовые 3D-печати'],
      ['paint', 'grit-assets/step-paint.webp', 'Покрашенная фигурка'],
      ['packaging', 'grit-assets/step-packaging.webp', 'Фигурка в готовой упаковке']
    ];
    const processSteps = enhancedGritSection.querySelectorAll('.grit-process .grit-steps > li');
    processSteps.forEach((step, index) => {
      const config = processAssets[index];
      if (!config) return;
      const [name, source, alt] = config;
      step.classList.add('grit-step-photo', `grit-step-photo--${name}`);
      step.tabIndex = 0;
      const image = document.createElement('img');
      image.className = 'grit-step-image';
      image.src = source;
      image.alt = alt;
      image.loading = 'lazy';
      image.decoding = 'async';
      image.draggable = false;
      step.prepend(image);

      step.addEventListener('click', () => {
        if (window.matchMedia('(hover:hover)').matches) return;
        const nextState = !step.classList.contains('is-preview');
        processSteps.forEach(item => item.classList.remove('is-preview'));
        step.classList.toggle('is-preview', nextState);
      });
      step.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        step.classList.toggle('is-preview');
      });
    });

    const processGallerySection = enhancedGritSection.querySelector('#grit-pax-process');
    const processRail = processGallerySection?.querySelector('.grit-gallery-rail');
    if (processGallerySection && processRail) {
      const captions = [
        {ru:'Эскиз', en:'Sketch'},
        {ru:'Черновая модель', en:'Raw model'},
        {ru:'Тест печати', en:'Print test'}
      ];
      const setImages = [
        [
          'grit-assets/process-photo-01.webp',
          'grit-assets/set01-raw.webp',
          'grit-assets/set01-print.webp'
        ],
        [
          'grit-assets/process-photo-02.webp',
          'grit-assets/process-photo-06.webp',
          'grit-assets/process-photo-10.webp'
        ],
        [
          'grit-assets/process-photo-03.webp',
          'grit-assets/process-photo-07.webp',
          'grit-assets/process-photo-11.webp'
        ],
        [
          'grit-assets/process-photo-04.webp',
          'grit-assets/process-photo-08.webp',
          'grit-assets/process-photo-12.webp'
        ],
        [
          'grit-assets/process-photo-05.webp',
          'grit-assets/process-photo-09.webp',
          'grit-assets/process-photo-13.webp'
        ]
      ];

      const addBilingualText = (parent, ru, en) => {
        const ruText = document.createElement('span');
        const enText = document.createElement('span');
        ruText.dataset.ru = '';
        enText.dataset.en = '';
        ruText.textContent = ru;
        enText.textContent = en;
        parent.append(ruText, enText);
      };

      const createSetCard = (setNumber, index) => {
        const caption = captions[index];
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'grit-card grit-set-card';
        card.dataset.gritCard = '';
        card.setAttribute('aria-label', `Сет ${setNumber}: ${caption.ru}`);

        const media = document.createElement('span');
        media.className = 'grit-card-media';
        const image = document.createElement('img');
        image.className = `grit-set-image grit-set-image--${['sketch','raw','print'][index]}`;
        image.src = setImages[setNumber - 1][index];
        image.alt = `${caption.ru}, набор ${setNumber}`;
        image.loading = 'lazy';
        image.decoding = 'async';
        image.draggable = false;
        media.append(image);

        const meta = document.createElement('span');
        meta.className = 'grit-card-meta';
        const number = document.createElement('span');
        number.className = 'mono';
        number.textContent = String(index + 1).padStart(2, '0');
        const title = document.createElement('span');
        addBilingualText(title, caption.ru, caption.en);
        meta.append(number, title);
        card.append(media, meta);
        return card;
      };

      const renderSet = setNumber => {
        processRail.replaceChildren(...captions.map((_, index) => createSetCard(setNumber, index)));
        processGallerySection.querySelector('.grit-gallery')?.scrollTo({left:0, behavior:reduceMotion ? 'auto' : 'smooth'});
      };

      const switcher = document.createElement('div');
      switcher.className = 'grit-set-switcher';
      switcher.setAttribute('role', 'group');
      switcher.setAttribute('aria-label', 'Наборы материалов процесса');
      for (let setNumber = 1; setNumber <= 5; setNumber += 1) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'grit-set-button';
        button.textContent = String(setNumber).padStart(2, '0');
        button.setAttribute('aria-label', `Показать набор ${setNumber}`);
        button.setAttribute('aria-pressed', String(setNumber === 1));
        button.classList.toggle('is-active', setNumber === 1);
        button.addEventListener('click', () => {
          switcher.querySelectorAll('.grit-set-button').forEach((item, buttonIndex) => {
            const active = buttonIndex + 1 === setNumber;
            item.classList.toggle('is-active', active);
            item.setAttribute('aria-pressed', String(active));
          });
          renderSet(setNumber);
        });
        switcher.append(button);
      }
      renderSet(1);
      processGallerySection.append(switcher);

      const processHintRu = processGallerySection.querySelector('.grit-gallery-hint [data-ru]');
      const processHintEn = processGallerySection.querySelector('.grit-gallery-hint [data-en]');
      if (processHintRu) processHintRu.textContent = 'НАЖМИТЕ НА ФОТО, ЧТОБЫ РАССМОТРЕТЬ';
      if (processHintEn) processHintEn.textContent = 'CLICK A PHOTO TO VIEW';

      const viewer = document.createElement('div');
      viewer.className = 'grit-process-viewer';
      viewer.hidden = true;
      viewer.setAttribute('role', 'dialog');
      viewer.setAttribute('aria-modal', 'true');
      viewer.setAttribute('aria-label', 'Просмотр материалов проекта');

      const viewerStage = document.createElement('div');
      viewerStage.className = 'grit-process-viewer-stage';
      const viewerImage = document.createElement('img');
      viewerImage.className = 'grit-process-viewer-image';
      viewerImage.alt = '';
      const viewerClose = document.createElement('button');
      viewerClose.className = 'grit-process-viewer-close';
      viewerClose.type = 'button';
      viewerClose.setAttribute('aria-label', 'Закрыть изображение');
      viewerClose.textContent = '×';
      const viewerPrev = document.createElement('button');
      viewerPrev.className = 'grit-process-viewer-arrow grit-process-viewer-arrow--prev';
      viewerPrev.type = 'button';
      viewerPrev.setAttribute('aria-label', 'Предыдущее изображение');
      const viewerNext = document.createElement('button');
      viewerNext.className = 'grit-process-viewer-arrow grit-process-viewer-arrow--next';
      viewerNext.type = 'button';
      viewerNext.setAttribute('aria-label', 'Следующее изображение');
      const viewerCaption = document.createElement('div');
      viewerCaption.className = 'grit-process-viewer-caption mono';
      viewerStage.append(viewerImage, viewerClose, viewerPrev, viewerNext, viewerCaption);
      viewer.append(viewerStage);
      document.body.append(viewer);

      let processSlides = [];
      let processIndex = 0;
      let processRestoreFocus = null;

      const updateProcessViewer = () => {
        const slide = processSlides[processIndex];
        if (!slide) return;
        viewerImage.src = slide.source;
        viewerImage.alt = slide.alt;
        viewerCaption.textContent = `${String(processIndex + 1).padStart(2, '0')} / ${String(processSlides.length).padStart(2, '0')}`;
        viewerPrev.hidden = processIndex === 0;
        viewerNext.hidden = processIndex === processSlides.length - 1;
      };

      const closeProcessViewer = () => {
        if (viewer.hidden) return;
        viewer.classList.remove('is-open');
        document.body.classList.remove('grit-viewer-open');
        window.setTimeout(() => {
          viewer.hidden = true;
          processRestoreFocus?.focus?.();
        }, reduceMotion ? 0 : 180);
      };

      const openProcessViewer = (card, image) => {
        processSlides = [...processRail.querySelectorAll('.grit-set-image')].map(item => ({
          source:item.currentSrc || item.src,
          alt:item.alt || 'Материал проекта'
        }));
        processIndex = [...processRail.querySelectorAll('.grit-set-card')].indexOf(card);
        if (!processSlides.length || processIndex < 0) return;
        processRestoreFocus = card;
        updateProcessViewer();
        viewer.hidden = false;
        document.body.classList.add('grit-viewer-open');
        requestAnimationFrame(() => {
          viewer.classList.add('is-open');
          viewerClose.focus();
        });
      };

      processRail.addEventListener('click', event => {
        const card = event.target.closest('.grit-set-card');
        const image = card?.querySelector('.grit-set-image');
        if (!card || !image) return;
        openProcessViewer(card, image);
      });
      viewerClose.addEventListener('click', closeProcessViewer);
      viewerPrev.addEventListener('click', () => {
        if (processIndex <= 0) return;
        processIndex -= 1;
        updateProcessViewer();
      });
      viewerNext.addEventListener('click', () => {
        if (processIndex >= processSlides.length - 1) return;
        processIndex += 1;
        updateProcessViewer();
      });
      viewer.addEventListener('click', event => {
        if (event.target === viewer) closeProcessViewer();
      });
      document.addEventListener('keydown', event => {
        if (viewer.hidden) return;
        if (event.key === 'Escape') closeProcessViewer();
        if (event.key === 'ArrowLeft' && processIndex > 0) {
          processIndex -= 1;
          updateProcessViewer();
        }
        if (event.key === 'ArrowRight' && processIndex < processSlides.length - 1) {
          processIndex += 1;
          updateProcessViewer();
        }
      });
    }

    const paxGallerySection = enhancedGritSection.querySelector('#grit-pax-anima');
    if (paxGallerySection) {
      paxGallerySection.querySelectorAll('[data-pax-card]').forEach(oldCard => {
        const stableCard = document.createElement('div');
        stableCard.className = oldCard.className;
        stableCard.tabIndex = 0;
        stableCard.setAttribute('aria-label', oldCard.getAttribute('aria-label') || 'PAX ANIMA');
        [...oldCard.children].forEach(child => stableCard.append(child.cloneNode(true)));
        oldCard.replaceWith(stableCard);
      });

      const hintRu = paxGallerySection.querySelector('.grit-gallery-hint [data-ru]');
      const hintEn = paxGallerySection.querySelector('.grit-gallery-hint [data-en]');
      if (hintRu) hintRu.textContent = 'НАВЕДИТЕ НА ФОТО, ЧТОБЫ УВИДЕТЬ АЛЬТЕРНАТИВНЫЙ КАДР';
      if (hintEn) hintEn.textContent = 'HOVER TO SEE THE ALTERNATE VIEW';
    }

    const createGritPhotoCard = ({source, ru, en, index, className = ''}) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `grit-card grit-photo-card ${className}`.trim();
      card.dataset.gritCard = '';
      card.setAttribute('aria-label', ru);
      const media = document.createElement('span');
      media.className = 'grit-card-media';
      const image = document.createElement('img');
      image.className = 'grit-photo-card-image';
      image.src = source;
      image.alt = ru;
      image.loading = 'lazy';
      image.decoding = 'async';
      image.draggable = false;
      media.append(image);
      const meta = document.createElement('span');
      meta.className = 'grit-card-meta';
      const number = document.createElement('span');
      number.className = 'mono';
      number.textContent = String(index + 1).padStart(2, '0');
      const title = document.createElement('span');
      const titleRu = document.createElement('span');
      const titleEn = document.createElement('span');
      titleRu.dataset.ru = '';
      titleEn.dataset.en = '';
      titleRu.textContent = ru;
      titleEn.textContent = en;
      title.append(titleRu, titleEn);
      meta.append(number, title);
      card.append(media, meta);
      return card;
    };

    const stressSection = enhancedGritSection.querySelector('#grit-stress');
    const stressRail = stressSection?.querySelector('.grit-gallery-rail');
    if (stressSection && stressRail) {
      stressSection.dataset.photoViewerGroup = 'stress';
      const stressItems = [
        {source:'grit-assets/stress-photo-01.webp', ru:'Готовая фигурка', en:'Finished figure'},
        {source:'grit-assets/stress-photo-02.webp', ru:'Тестовая модель 1', en:'Test model 1'},
        {source:'grit-assets/stress-photo-03.webp', ru:'Тестовая модель 2', en:'Test model 2'},
        {source:'grit-assets/stress-photo-04.webp', ru:'Тестовая модель 3', en:'Test model 3'},
        {source:'grit-assets/stress-photo-05.webp', ru:'Эскизы', en:'Sketches', className:'grit-stress-card--wide'}
      ];
      stressRail.replaceChildren(...stressItems.map((item, index) => createGritPhotoCard({...item, index})));
    }

    const merchSection = enhancedGritSection.querySelector('#grit-merch-concepts');
    const merchGallery = merchSection?.querySelector('.grit-gallery');
    const merchRail = merchSection?.querySelector('.grit-gallery-rail');
    if (merchSection && merchGallery && merchRail) {
      merchSection.dataset.photoViewerGroup = 'merch';
      const merchSets = [
        {
          name:'ПУТЧ',
          icon:'grit-assets/merch-tab-putch.webp',
          photos:Array.from({length:6}, (_, index) => `grit-assets/merch-putch-${String(index + 1).padStart(2, '0')}.webp`)
        },
        {
          name:'ВОВАВАРИТ',
          icon:'grit-assets/merch-tab-vovavarit.webp',
          photos:Array.from({length:3}, (_, index) => `grit-assets/merch-vovavarit-${String(index + 1).padStart(2, '0')}.webp`)
        }
      ];

      const renderMerchSet = setIndex => {
        const set = merchSets[setIndex];
        const cards = set.photos.map((source, index) => {
          const card = document.createElement('button');
          card.type = 'button';
          card.className = 'grit-card grit-merch-card';
          card.dataset.gritCard = '';
          card.setAttribute('aria-label', `${set.name}: изображение ${index + 1}`);
          const media = document.createElement('span');
          media.className = 'grit-card-media';
          const image = document.createElement('img');
          image.className = 'grit-merch-image';
          image.src = source;
          image.alt = `${set.name}, изображение ${index + 1}`;
          image.loading = 'lazy';
          image.decoding = 'async';
          image.draggable = false;
          media.append(image);
          card.append(media);
          return card;
        });
        merchRail.replaceChildren(...cards);
        merchGallery.scrollTo({left:0, behavior:reduceMotion ? 'auto' : 'smooth'});
      };

      const merchSwitcher = document.createElement('div');
      merchSwitcher.className = 'grit-merch-switcher';
      merchSwitcher.setAttribute('role', 'group');
      merchSwitcher.setAttribute('aria-label', 'Выбор серии сувенирной продукции');
      merchSets.forEach((set, setIndex) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'grit-merch-tab';
        button.classList.toggle('is-active', setIndex === 0);
        button.setAttribute('aria-label', set.name);
        button.setAttribute('aria-pressed', String(setIndex === 0));
        const image = document.createElement('img');
        image.loading = 'lazy';
        image.decoding = 'async';
        image.src = set.icon;
        image.alt = '';
        image.dataset.photoViewerIgnore = '';
        image.draggable = false;
        const label = document.createElement('span');
        label.textContent = set.name;
        button.append(image, label);
        button.addEventListener('click', () => {
          merchSwitcher.querySelectorAll('.grit-merch-tab').forEach((item, itemIndex) => {
            const active = itemIndex === setIndex;
            item.classList.toggle('is-active', active);
            item.setAttribute('aria-pressed', String(active));
          });
          renderMerchSet(setIndex);
        });
        merchSwitcher.append(button);
      });
      merchGallery.before(merchSwitcher);
      renderMerchSet(0);
    }

    enhancedGritSection.querySelector('#pax-modal')?.remove();
  }

  const addGalleryArrows = (viewport, theme, onStep) => {
    if (!viewport || viewport.closest('.gallery-nav-frame')) return;
    const frame = document.createElement('div');
    frame.className = `gallery-nav-frame gallery-nav-frame--${theme}`;
    viewport.before(frame);
    frame.append(viewport);

    const controls = document.createElement('div');
    controls.className = `gallery-nav gallery-nav--${theme}`;
    const previous = document.createElement('button');
    previous.className = 'gallery-arrow gallery-arrow--prev';
    previous.type = 'button';
    previous.setAttribute('aria-label', 'Предыдущее изображение');
    const next = document.createElement('button');
    next.className = 'gallery-arrow gallery-arrow--next';
    next.type = 'button';
    next.setAttribute('aria-label', 'Следующее изображение');
    previous.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      onStep(-1);
    });
    next.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      onStep(1);
    });
    controls.append(previous, next);
    frame.append(controls);
  };

  document.querySelectorAll('[data-poster-carousel]').forEach(carousel => {
    addGalleryArrows(carousel.querySelector('.poster-viewport'), 'light', direction => {
      carousel.dispatchEvent(new CustomEvent('portfolio-poster-step', {detail:{direction}}));
    });
  });

  document.querySelectorAll('#ch2 [data-loop-gallery]').forEach(panel => {
    addGalleryArrows(panel.querySelector('.product-panel-viewport'), 'light', direction => {
      panel.dispatchEvent(new CustomEvent('portfolio-product-step', {detail:{direction}}));
    });
  });

  ['#grit-pax-anima', '#grit-stress', '#grit-merch-concepts'].forEach(selector => {
    const section = document.querySelector(selector);
    const viewport = section?.querySelector('.grit-gallery');
    addGalleryArrows(viewport, 'dark', direction => {
      const card = viewport.querySelector('.grit-card');
      const railGap = Number.parseFloat(getComputedStyle(viewport.querySelector('.grit-gallery-rail')).gap) || 0;
      const distance = card ? card.getBoundingClientRect().width + railGap : viewport.clientWidth * .78;
      viewport.scrollBy({left:direction * distance, behavior:reduceMotion ? 'auto' : 'smooth'});
    });
  });

  const revealTargets = [
    ...document.querySelectorAll('.hero-profile-grid, section.chapter:not(#ch6), #ch6 .grit-about, #ch6 .grit-process, #ch6 .grit-work-section')
  ];

  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealTargets.forEach(element => element.classList.add('is-visible'));
  } else {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, {threshold:.06, rootMargin:'0px 0px -9% 0px'});

    revealTargets.forEach(element => {
      element.classList.add('reveal-section');
      observer.observe(element);
    });
  }

  const precisePointer = window.matchMedia('(pointer:fine)').matches;
  // Keep native wheel and trackpad scrolling intact. This preserves macOS
  // momentum and avoids multiplying small high-frequency trackpad deltas.

  document.querySelectorAll('#ch6 [data-grit-gallery]').forEach(viewport => {
    const rail = viewport.querySelector('.grit-gallery-rail');
    if (!rail) return;
    if (viewport.closest('#grit-pax-process')) {
      viewport.classList.add('grit-gallery--static');
      return;
    }
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startScroll = 0;

    viewport.querySelectorAll('img').forEach(image => image.draggable = false);
    viewport.addEventListener('dragstart', event => event.preventDefault());
    viewport.addEventListener('pointerdown', event => {
      if (event.button !== undefined && event.button !== 0) return;
      dragging = true;
      moved = false;
      startX = event.clientX;
      startScroll = viewport.scrollLeft;
      viewport.classList.add('is-dragging');
      viewport.setPointerCapture?.(event.pointerId);
    });
    viewport.addEventListener('pointermove', event => {
      if (!dragging) return;
      const distance = event.clientX - startX;
      if (Math.abs(distance) > 3) moved = true;
      viewport.scrollLeft = startScroll - distance;
    });
    const endDrag = event => {
      if (!dragging) return;
      dragging = false;
      viewport.classList.remove('is-dragging');
      viewport.releasePointerCapture?.(event.pointerId);
    };
    viewport.addEventListener('pointerup', endDrag);
    viewport.addEventListener('pointercancel', endDrag);
    viewport.addEventListener('click', event => {
      if (!moved) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      moved = false;
    }, true);
  });

  const photoViewer = document.createElement('div');
  photoViewer.className = 'portfolio-photo-viewer';
  photoViewer.hidden = true;
  photoViewer.setAttribute('role', 'dialog');
  photoViewer.setAttribute('aria-modal', 'true');
  photoViewer.setAttribute('aria-label', 'Просмотр фотографии');
  photoViewer.innerHTML = `
    <div class="portfolio-photo-viewer-stage">
      <img class="portfolio-photo-viewer-image" alt="">
      <button class="portfolio-photo-viewer-close" type="button" aria-label="Закрыть фотографию">×</button>
      <button class="portfolio-photo-viewer-nav portfolio-photo-viewer-nav--prev" type="button" aria-label="Предыдущая фотография"></button>
      <button class="portfolio-photo-viewer-nav portfolio-photo-viewer-nav--next" type="button" aria-label="Следующая фотография"></button>
      <div class="portfolio-photo-viewer-tools" aria-label="Масштаб фотографии">
        <button type="button" data-photo-zoom-out aria-label="Уменьшить фотографию">−</button>
        <span class="mono" data-photo-zoom-label>100%</span>
        <button type="button" data-photo-zoom-in aria-label="Увеличить фотографию">+</button>
      </div>
      <div class="portfolio-photo-viewer-count mono"></div>
    </div>`;
  document.body.append(photoViewer);

  const photoViewerStage = photoViewer.querySelector('.portfolio-photo-viewer-stage');
  const photoViewerImage = photoViewer.querySelector('.portfolio-photo-viewer-image');
  const photoViewerClose = photoViewer.querySelector('.portfolio-photo-viewer-close');
  const photoViewerPrev = photoViewer.querySelector('.portfolio-photo-viewer-nav--prev');
  const photoViewerNext = photoViewer.querySelector('.portfolio-photo-viewer-nav--next');
  const photoZoomOut = photoViewer.querySelector('[data-photo-zoom-out]');
  const photoZoomIn = photoViewer.querySelector('[data-photo-zoom-in]');
  const photoZoomLabel = photoViewer.querySelector('[data-photo-zoom-label]');
  const photoViewerCount = photoViewer.querySelector('.portfolio-photo-viewer-count');
  let photoSlides = [];
  let photoIndex = 0;
  let photoZoom = 1;
  let photoPanX = 0;
  let photoPanY = 0;
  let photoPanStart = null;
  let photoRestoreFocus = null;

  const isPhotoViewerImage = image => {
    if (!(image instanceof HTMLImageElement)) return false;
    if (image.dataset.photoViewerIgnore !== undefined) return false;
    if (image.classList.contains('grit-set-image')) return false;
    if (image.closest('.crt-intro-shell,.portfolio-photo-viewer,.grit-process-viewer,header,.grit-logo-switch,.contact')) return false;
    return Boolean(image.closest('figure,article,.product-panel-viewport,.poster-viewport,.grit-card,.print-mockup-stage,.brand-stage,.about-section,.hero-profile-grid'));
  };

  const photoViewerImageFromTarget = target => {
    const directImage = target.closest?.('img');
    if (isPhotoViewerImage(directImage)) return directImage;
    const media = target.closest?.('.poster-card-inner,.grit-card-media,.product-panel-viewport,.print-mockup-stage,.brand-stage');
    const nestedImage = media?.querySelector('img');
    return isPhotoViewerImage(nestedImage) ? nestedImage : null;
  };

  const applyPhotoTransform = () => {
    photoViewerImage.style.transform = `translate3d(${photoPanX}px,${photoPanY}px,0) scale(${photoZoom})`;
    photoZoomLabel.textContent = `${Math.round(photoZoom * 100)}%`;
    photoZoomOut.disabled = photoZoom <= 1;
    photoZoomIn.disabled = photoZoom >= 4;
    photoViewerImage.classList.toggle('is-zoomed', photoZoom > 1);
  };

  const resetPhotoZoom = () => {
    photoZoom = 1;
    photoPanX = 0;
    photoPanY = 0;
    applyPhotoTransform();
  };

  const updatePhotoViewer = () => {
    const slide = photoSlides[photoIndex];
    if (!slide) return;
    photoViewerImage.classList.remove('is-portrait');
    photoViewerStage.classList.remove('has-portrait');
    photoViewerImage.src = slide.source;
    photoViewerImage.alt = slide.alt;
    photoViewerPrev.hidden = photoIndex === 0;
    photoViewerNext.hidden = photoIndex === photoSlides.length - 1;
    photoViewerCount.textContent = `${String(photoIndex + 1).padStart(2, '0')} / ${String(photoSlides.length).padStart(2, '0')}`;
    resetPhotoZoom();
  };

  const syncPhotoOrientation = () => {
    const portrait = photoViewerImage.naturalHeight > photoViewerImage.naturalWidth;
    photoViewerImage.classList.toggle('is-portrait', portrait);
    photoViewerStage.classList.toggle('has-portrait', portrait);
  };
  photoViewerImage.addEventListener('load', syncPhotoOrientation);

  const closePhotoViewer = () => {
    if (photoViewer.hidden) return;
    photoViewer.classList.remove('is-open');
    document.body.classList.remove('portfolio-photo-viewer-open');
    window.setTimeout(() => {
      photoViewer.hidden = true;
      photoRestoreFocus?.focus?.();
    }, reduceMotion ? 0 : 180);
  };

  const openPhotoViewer = image => {
    const group = image.closest('[data-photo-viewer-group],.poster-carousel,[data-loop-gallery],.product-panel,.grit-work-section,.comic-block,.about-section,.hero-profile-grid') || image.parentElement;
    const seen = new Set();
    photoSlides = [...group.querySelectorAll('img')].filter(candidate => {
      if (!isPhotoViewerImage(candidate) || !candidate.getClientRects().length) return false;
      const style = getComputedStyle(candidate);
      if (style.visibility === 'hidden' || Number.parseFloat(style.opacity) < .05) return false;
      const source = candidate.currentSrc || candidate.src;
      if (!source || seen.has(source)) return false;
      seen.add(source);
      return true;
    }).map(candidate => ({source:candidate.currentSrc || candidate.src, alt:candidate.alt || 'Фотография проекта'}));
    const targetSource = image.currentSrc || image.src;
    photoIndex = photoSlides.findIndex(slide => slide.source === targetSource);
    if (photoIndex < 0) {
      photoSlides = [{source:targetSource, alt:image.alt || 'Фотография проекта'}];
      photoIndex = 0;
    }
    photoRestoreFocus = image.closest('button,[tabindex],a') || image;
    updatePhotoViewer();
    photoViewer.hidden = false;
    document.body.classList.add('portfolio-photo-viewer-open');
    requestAnimationFrame(() => {
      photoViewer.classList.add('is-open');
      photoViewerClose.focus();
    });
  };

  let photoPointerCandidate = null;
  let suppressPhotoClick = false;
  document.addEventListener('pointerdown', event => {
    const image = photoViewerImageFromTarget(event.target);
    hydrateImage(image);
    suppressPhotoClick = false;
    photoPointerCandidate = isPhotoViewerImage(image)
      ? {image, x:event.clientX, y:event.clientY, pointerId:event.pointerId}
      : null;
  }, true);
  document.addEventListener('pointerup', event => {
    const candidate = photoPointerCandidate;
    photoPointerCandidate = null;
    if (!candidate || candidate.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - candidate.x, event.clientY - candidate.y) > 6) {
      suppressPhotoClick = true;
      window.setTimeout(() => { suppressPhotoClick = false; }, 350);
      return;
    }
    window.setTimeout(() => {
      if (photoViewer.hidden && candidate.image.isConnected) openPhotoViewer(candidate.image);
    }, 0);
  }, true);
  document.addEventListener('pointercancel', () => { photoPointerCandidate = null; }, true);
  document.addEventListener('click', event => {
    if (photoViewer.contains(event.target)) return;
    const image = photoViewerImageFromTarget(event.target);
    if (!image) return;
    event.preventDefault();
    if (suppressPhotoClick) {
      suppressPhotoClick = false;
      return;
    }
    openPhotoViewer(image);
  }, true);
  photoViewerClose.addEventListener('click', closePhotoViewer);
  photoViewer.addEventListener('click', event => {
    if (event.target === photoViewer) closePhotoViewer();
  });
  photoViewerPrev.addEventListener('click', () => {
    if (photoIndex <= 0) return;
    photoIndex -= 1;
    updatePhotoViewer();
  });
  photoViewerNext.addEventListener('click', () => {
    if (photoIndex >= photoSlides.length - 1) return;
    photoIndex += 1;
    updatePhotoViewer();
  });
  const changePhotoZoom = delta => {
    photoZoom = Math.min(4, Math.max(1, Math.round((photoZoom + delta) * 4) / 4));
    if (photoZoom === 1) {
      photoPanX = 0;
      photoPanY = 0;
    }
    applyPhotoTransform();
  };
  photoZoomOut.addEventListener('click', () => changePhotoZoom(-.5));
  photoZoomIn.addEventListener('click', () => changePhotoZoom(.5));
  photoViewerStage.addEventListener('wheel', event => {
    event.preventDefault();
    changePhotoZoom(event.deltaY < 0 ? .25 : -.25);
  }, {passive:false});
  photoViewerImage.addEventListener('pointerdown', event => {
    if (photoZoom <= 1) return;
    photoPanStart = {x:event.clientX, y:event.clientY, panX:photoPanX, panY:photoPanY};
    photoViewerImage.setPointerCapture?.(event.pointerId);
  });
  photoViewerImage.addEventListener('pointermove', event => {
    if (!photoPanStart) return;
    photoPanX = photoPanStart.panX + event.clientX - photoPanStart.x;
    photoPanY = photoPanStart.panY + event.clientY - photoPanStart.y;
    applyPhotoTransform();
  });
  const endPhotoPan = () => { photoPanStart = null; };
  photoViewerImage.addEventListener('pointerup', endPhotoPan);
  photoViewerImage.addEventListener('pointercancel', endPhotoPan);
  document.addEventListener('keydown', event => {
    if (photoViewer.hidden) return;
    if (event.key === 'Escape') closePhotoViewer();
    if (event.key === 'ArrowLeft' && photoIndex > 0) {
      photoIndex -= 1;
      updatePhotoViewer();
    }
    if (event.key === 'ArrowRight' && photoIndex < photoSlides.length - 1) {
      photoIndex += 1;
      updatePhotoViewer();
    }
    if (event.key === '+' || event.key === '=') changePhotoZoom(.5);
    if (event.key === '-') changePhotoZoom(-.5);
  });

  if (precisePointer) {
    document.querySelectorAll('.elastic-cursor').forEach(existingCursor => existingCursor.remove());
    const cursor = document.createElement('div');
    cursor.className = 'elastic-cursor';
    cursor.setAttribute('aria-hidden', 'true');
    const hand = document.createElement('img');
    hand.className = 'elastic-cursor-hand';
    hand.src = 'cursor-hand.png';
    hand.alt = '';
    hand.draggable = false;
    cursor.append(hand);
    document.body.append(cursor);
    document.body.classList.add('elastic-cursor-enabled');

    window.addEventListener('pointermove', event => {
      if (event.pointerType === 'touch') return;
      cursor.style.transform = `translate3d(${event.clientX - 25}px,${event.clientY - 7}px,0)`;
      cursor.classList.add('is-visible');
    }, {passive:true});

    document.documentElement.addEventListener('mouseleave', () => cursor.classList.remove('is-visible'));
    document.documentElement.addEventListener('mouseenter', () => cursor.classList.add('is-visible'));
  }
})();
