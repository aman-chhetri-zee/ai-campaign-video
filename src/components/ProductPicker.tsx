"use client";

export type CatalogProduct = {
  id: string;
  image_url: string;
  primary_item_type: string;
  overall_description: string;
};

// ProductPicker is retained as a shared component with a dark-theme variant.
// The video-poc page uses an inline CatalogGrid for the always-visible catalog,
// but other pages can still import and use this component.
export function ProductPicker(props: {
  products: CatalogProduct[];
  selected: string[];
  onChange: (ids: string[]) => void;
  max?: number;
}) {
  const max = props.max ?? 2;
  const toggle = (id: string) => {
    if (props.selected.includes(id)) {
      props.onChange(props.selected.filter((x) => x !== id));
    } else if (props.selected.length < max) {
      props.onChange([...props.selected, id]);
    }
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {props.products.map((p) => {
        const isSelected = props.selected.includes(p.id);
        const isDisabled = !isSelected && props.selected.length >= max;
        return (
          <button
            key={p.id}
            type="button"
            disabled={isDisabled}
            onClick={() => toggle(p.id)}
            className={`relative rounded-xl border-2 p-2 text-left transition-all ${
              isSelected
                ? "border-blue-500 ring-2 ring-blue-500/40 bg-zinc-800"
                : isDisabled
                  ? "border-zinc-800 opacity-40 cursor-not-allowed bg-zinc-900"
                  : "border-zinc-800 hover:border-zinc-600 bg-zinc-900 hover:bg-zinc-800"
            }`}
          >
            <img
              src={p.image_url}
              alt={p.primary_item_type}
              className="w-full aspect-square object-cover rounded-lg"
            />
            <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-zinc-100">
              {p.primary_item_type}
            </div>
            <div className="text-xs text-zinc-400 line-clamp-2 mt-0.5">
              {p.overall_description}
            </div>
            {isSelected && (
              <div className="absolute top-1.5 right-1.5 bg-blue-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold">
                {props.selected.indexOf(p.id) + 1}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
