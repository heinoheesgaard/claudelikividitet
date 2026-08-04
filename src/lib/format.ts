export function formatDKK(amount: number): string {
  return new Intl.NumberFormat("da-DK", {
    style: "currency",
    currency: "DKK",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("da-DK", { dateStyle: "medium" }).format(new Date(iso));
}

export function fetcher(url: string) {
  return fetch(url).then((res) => {
    if (!res.ok) throw new Error("Kunne ikke hente data");
    return res.json();
  });
}
