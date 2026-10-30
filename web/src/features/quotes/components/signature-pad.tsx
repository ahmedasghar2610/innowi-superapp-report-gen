"use client";

import { useEffect, useRef, useState } from "react";
import { Eraser } from "lucide-react";
import { Input, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui";
import type { SignMethod } from "../types";

export interface SignatureValue {
  method: SignMethod;
  /** PNG data URL for DRAWN, the adopted text for TYPED; null while empty. */
  data: string | null;
}

/**
 * Draw a signature on a canvas, or type it (rendered in an italic serif, the
 * adopted-signature convention). Produces a PNG data URL or the typed text.
 */
export function SignaturePad({ value, onChange, label = "Your signature" }: {
  value: SignatureValue;
  onChange: (v: SignatureValue) => void;
  label?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const hasInk = useRef(false);
  const [typed, setTyped] = useState(value.method === "TYPED" ? (value.data ?? "") : "");

  // A crisp canvas on retina screens: scale the backing store, keep CSS size.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(scale, scale);
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#111827";
    }
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawing.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    // A dot for a tap, so even the shortest stroke leaves ink.
    ctx.lineTo(p.x + 0.1, p.y + 0.1);
    ctx.stroke();
    hasInk.current = true;
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const p = point(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    const canvas = canvasRef.current;
    if (canvas && hasInk.current) onChange({ method: "DRAWN", data: canvas.toDataURL("image/png") });
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasInk.current = false;
    if (value.method === "DRAWN") onChange({ method: "DRAWN", data: null });
  };

  const setMethod = (m: string) => {
    if (m === "DRAWN") onChange({ method: "DRAWN", data: hasInk.current ? (canvasRef.current?.toDataURL("image/png") ?? null) : null });
    else onChange({ method: "TYPED", data: typed.trim() || null });
  };

  return (
    <div>
      <div className="mb-1.5 text-sm font-medium text-foreground">{label}</div>
      <Tabs value={value.method} onValueChange={setMethod}>
        <TabsList>
          <TabsTrigger value="DRAWN">Draw</TabsTrigger>
          <TabsTrigger value="TYPED">Type</TabsTrigger>
        </TabsList>
        <TabsContent value="DRAWN">
          <div className="relative mt-2">
            <canvas
              ref={canvasRef}
              className="h-32 w-full cursor-crosshair touch-none rounded-lg border border-border bg-background"
              onPointerDown={start}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              aria-label="Signature drawing area"
            />
            <div className="pointer-events-none absolute inset-x-4 bottom-6 border-b border-dashed border-border" />
            <button
              type="button"
              onClick={clear}
              className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground hover:bg-secondary"
            >
              <Eraser className="size-3.5" aria-hidden /> Clear
            </button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Sign above the line with your mouse or finger.</p>
        </TabsContent>
        <TabsContent value="TYPED">
          <div className="mt-2 flex flex-col gap-2">
            <Input
              value={typed}
              placeholder="Type your full name"
              onChange={(e) => {
                setTyped(e.target.value);
                onChange({ method: "TYPED", data: e.target.value.trim() || null });
              }}
            />
            <div className="flex h-16 items-center rounded-lg border border-border bg-background px-4">
              <span className="font-serif text-2xl italic text-foreground">{typed.trim() || "Your signature"}</span>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** Render a stored signature (drawn image or typed text) inline. */
export function SignatureView({ method, data, className }: { method: SignMethod; data: string; className?: string }) {
  if (method === "DRAWN" && data.startsWith("data:image/png")) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={data} alt="Signature" className={className ?? "h-12 w-auto"} />;
  }
  return <span className={className ?? "font-serif text-xl italic text-foreground"}>{data}</span>;
}
