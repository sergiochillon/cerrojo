// Cliente HTTP deliberadamente conservador: pocas peticiones, espaciadas y con límite total.
// Una auditoría no debe parecerse a un ataque ni degradar el servicio auditado.

const AGENTE = 'cerrojo/0.1 (auditoria de seguridad autorizada por el titular)';

export class Cliente {
  /**
   * @param {{pausaMs?: number, maxPeticiones?: number, timeoutMs?: number, fetch?: typeof fetch}} [op]
   */
  constructor(op = {}) {
    this.pausaMs = op.pausaMs ?? 150;
    this.maxPeticiones = op.maxPeticiones ?? 200;
    this.timeoutMs = op.timeoutMs ?? 12000;
    this.fetch = op.fetch ?? globalThis.fetch;
    this.hechas = 0;
    this.ultima = 0;
  }

  /**
   * @returns {Promise<{ok: boolean, estado: number, cabeceras: Headers|null, texto: string, error?: string, url: string}>}
   */
  async pedir(url, { metodo = 'GET', cabeceras = {}, cuerpo, maxBytes = 3_000_000 } = {}) {
    if (this.hechas >= this.maxPeticiones) {
      return { ok: false, estado: 0, cabeceras: null, texto: '', error: 'limite_de_peticiones', url };
    }
    const espera = this.ultima + this.pausaMs - Date.now();
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));
    this.hechas++;
    this.ultima = Date.now();

    const control = new AbortController();
    const temporizador = setTimeout(() => control.abort(), this.timeoutMs);
    try {
      const r = await this.fetch(url, {
        method: metodo,
        headers: { 'User-Agent': AGENTE, ...cabeceras },
        body: cuerpo,
        signal: control.signal,
        redirect: 'follow',
      });
      let texto = '';
      if (metodo !== 'HEAD') {
        const bytes = new Uint8Array(await r.arrayBuffer());
        texto = Buffer.from(bytes.subarray(0, maxBytes)).toString('utf8');
      }
      return { ok: r.ok, estado: r.status, cabeceras: r.headers, texto, url: r.url || url };
    } catch (e) {
      const error = e?.name === 'AbortError' ? 'tiempo_agotado' : `red: ${e?.cause?.code || e?.message || e}`;
      return { ok: false, estado: 0, cabeceras: null, texto: '', error, url };
    } finally {
      clearTimeout(temporizador);
    }
  }
}

export function json(texto) {
  try {
    return JSON.parse(texto);
  } catch {
    return undefined;
  }
}
