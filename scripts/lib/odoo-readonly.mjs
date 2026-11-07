const MODELS = new Set([
  'product.template',
  'product.public.category',
  'product.template.attribute.line',
  'product.attribute.value',
  'product.image',
]);
const METHODS = new Set(['search_read', 'search_count', 'fields_get', 'read']);

export class OdooReader {
  constructor(config, fetcher = fetch) {
    this.config = config;
    this.fetcher = fetcher;
    if (!config.url || !config.database || !config.key)
      throw new Error('Missing Odoo configuration');
    if (new URL(config.url).protocol !== 'https:')
      throw new Error('Odoo requires HTTPS');
  }

  async call(model, method, params) {
    if (!MODELS.has(model) || !METHODS.has(method))
      throw new Error('Read-only Odoo request rejected');
    for (let attempt = 0; attempt < 3; attempt++) {
      let response;
      try {
        response = await this.fetcher(
          `${this.config.url.replace(/\/$/, '')}/json/2/${model}/${method}`,
          {
            method: 'POST',
            headers: {
              Authorization: `bearer ${this.config.key}`,
              'X-Odoo-Database': this.config.database,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(params),
            signal: AbortSignal.timeout(60000),
          },
        );
      } catch {
        if (attempt === 2) throw new Error('Odoo read connection failed');
      }
      if (response?.ok) return response.json();
      if (response && ![429, 502, 503, 504].includes(response.status))
        throw new Error(`Odoo read failed (${response.status})`);
      if (attempt === 2)
        throw new Error(`Odoo read failed (${response?.status ?? 'timeout'})`);
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }

  async all(model, domain, fields, batchSize = 200) {
    const result = [];
    let last = 0;
    while (true) {
      const page = await this.call(model, 'search_read', {
        domain: [...domain, ['id', '>', last]],
        fields: [...new Set(['id', ...fields])],
        order: 'id asc',
        limit: batchSize,
      });
      if (!page.length) break;
      result.push(...page);
      last = page.at(-1).id;
      if (page.length < batchSize) break;
    }
    return result;
  }
}
