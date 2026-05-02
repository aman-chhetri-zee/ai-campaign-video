"use client";

export type CatalogProduct = {
  id: string;
  image_url: string;
  primary_item_type: string;
  overall_description: string;
};

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
            className={`relative rounded-lg border-2 p-2 text-left transition ${
              isSelected
                ? "border-blue-500 ring-2 ring-blue-200"
                : isDisabled
                  ? "border-gray-200 opacity-40 cursor-not-allowed"
                  : "border-gray-200 hover:border-gray-400"
            }`}
          >
            <img
              src={p.image_url}
              alt={p.primary_item_type}
              className="w-full aspect-square object-cover rounded"
            />
            <div className="mt-2 text-sm font-medium">{p.primary_item_type}</div>
            <div className="text-xs text-gray-500 line-clamp-2">
              {p.overall_description}
            </div>
            {isSelected && (
              <div className="absolute top-1 right-1 bg-blue-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs">
                {props.selected.indexOf(p.id) + 1}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
