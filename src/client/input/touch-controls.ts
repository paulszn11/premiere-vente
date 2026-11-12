// Commandes tactiles : joystick virtuel à gauche, regard en glissant à droite,
// boutons Sauter / Courir / Menu.

const JOY_RADIUS = 56;

export class TouchControls {
  moveX = 0;
  moveY = 0;
  lookDX = 0;
  lookDY = 0;
  jumpHeld = false;
  sprintOn = false;
  crouchOn = false;
  interactHeld = false;
  throwHeld = false;
  private joyId: number | null = null;
  private joyOrigin = { x: 0, y: 0 };
  private lookId: number | null = null;
  private lastLook = { x: 0, y: 0 };
  private readonly base: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly sprintBtn: HTMLElement;
  private readonly crouchBtn: HTMLElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly onMenu: () => void,
  ) {
    this.base = root.querySelector('.joy-base')!;
    this.knob = root.querySelector('.joy-knob')!;
    this.sprintBtn = root.querySelector('[data-touch="sprint"]')!;
    this.crouchBtn = root.querySelector('[data-touch="crouch"]')!;
    root.addEventListener('pointerdown', this.onDown);
    root.addEventListener('pointermove', this.onMove);
    root.addEventListener('pointerup', this.onUp);
    root.addEventListener('pointercancel', this.onUp);
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    this.bindButton('jump', (down) => {
      this.jumpHeld = down;
    });
    this.bindButton('sprint', (down) => {
      if (down) {
        this.sprintOn = !this.sprintOn;
        this.sprintBtn.classList.toggle('on', this.sprintOn);
      }
    });
    this.bindButton('crouch', (down) => {
      if (down) {
        this.crouchOn = !this.crouchOn;
        this.crouchBtn.classList.toggle('on', this.crouchOn);
      }
    });
    this.bindButton('interact', (down) => {
      this.interactHeld = down;
    });
    this.bindButton('throw', (down) => {
      this.throwHeld = down;
    });
    this.bindButton('menu', (down) => {
      if (down) this.onMenu();
    });
  }

  private bindButton(name: string, cb: (down: boolean) => void): void {
    const el = this.root.querySelector<HTMLElement>(`[data-touch="${name}"]`)!;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      el.classList.add('pressed');
      cb(true);
    });
    const release = (e: PointerEvent) => {
      e.stopPropagation();
      el.classList.remove('pressed');
      cb(false);
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  show(visible: boolean): void {
    this.root.hidden = !visible;
    if (!visible) this.reset();
  }

  reset(): void {
    this.joyId = null;
    this.lookId = null;
    this.moveX = 0;
    this.moveY = 0;
    this.lookDX = 0;
    this.lookDY = 0;
    this.jumpHeld = false;
    this.interactHeld = false;
    this.throwHeld = false;
    this.base.hidden = true;
  }

  /** Récupère le mouvement du regard accumulé depuis le dernier appel. */
  takeLook(): { dx: number; dy: number } {
    const out = { dx: this.lookDX, dy: this.lookDY };
    this.lookDX = 0;
    this.lookDY = 0;
    return out;
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') return;
    e.preventDefault();
    this.root.setPointerCapture(e.pointerId);
    if (e.clientX < window.innerWidth * 0.45 && this.joyId === null) {
      this.joyId = e.pointerId;
      this.joyOrigin = { x: e.clientX, y: e.clientY };
      this.base.style.left = `${e.clientX}px`;
      this.base.style.top = `${e.clientY}px`;
      this.knob.style.transform = 'translate(-50%, -50%)';
      this.base.hidden = false;
    } else if (this.lookId === null) {
      this.lookId = e.pointerId;
      this.lastLook = { x: e.clientX, y: e.clientY };
    }
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (e.pointerId === this.joyId) {
      let dx = e.clientX - this.joyOrigin.x;
      let dy = e.clientY - this.joyOrigin.y;
      const len = Math.hypot(dx, dy);
      if (len > JOY_RADIUS) {
        dx = (dx / len) * JOY_RADIUS;
        dy = (dy / len) * JOY_RADIUS;
      }
      this.moveX = dx / JOY_RADIUS;
      this.moveY = -dy / JOY_RADIUS;
      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    } else if (e.pointerId === this.lookId) {
      this.lookDX += e.clientX - this.lastLook.x;
      this.lookDY += e.clientY - this.lastLook.y;
      this.lastLook = { x: e.clientX, y: e.clientY };
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (e.pointerId === this.joyId) {
      this.joyId = null;
      this.moveX = 0;
      this.moveY = 0;
      this.base.hidden = true;
    } else if (e.pointerId === this.lookId) {
      this.lookId = null;
    }
  };
}
