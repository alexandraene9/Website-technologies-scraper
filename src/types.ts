export type Layer = "http" | "browser" | "dns" | "tls";

export interface PageSignals {
  layer: Layer;
  url?: string;
  urls?: string[];
  headers?: Record<string, string[]>;
  cookies?: Record<string, string>;
  html?: string;
  scripts?: string[];
  externalScripts?: string[];
  externalCss?: string[];
  scriptSrc?: string[];
  meta?: Record<string, string[]>;
  text?: string;
  css?: string[];
  xhr?: string[];
  js?: Record<string, string>;
  dns?: Record<string, string[]>;
  certIssuer?: string;
  robots?: string;
}

export interface Evidence {
  layer: Layer;
  type: string;
  key?: string;
  pattern: string;
  value: string;
  confidence: number;
}

export interface Detection {
  name: string;
  categories: string[];
  version: string | null;
  confidence: number;
  website?: string;
  evidence: Evidence[];
  impliedBy?: string[];
}

export interface DomainRaw {
  domain: string;
  fetchedAt: string;
  status: "ok" | "partial" | "unreachable";
  errors: { layer: Layer; message: string }[];
  notes?: string[];
  finalUrl?: string;
  layers: PageSignals[];
  timingsMs: Partial<Record<Layer, number>>;
}

export interface DomainResult {
  domain: string;
  status: DomainRaw["status"];
  finalUrl?: string;
  errors: DomainRaw["errors"];
  technologyCount: number;
  technologies: Detection[];
  lowConfidence: Detection[];
}
