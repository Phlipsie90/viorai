interface StatCardProps {
  label: string;
  value: string | number;
  description?: string;
}

export default function StatCard({ label, value, description }: StatCardProps) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-5">
      <p className="text-xs text-slate-500 uppercase tracking-wide font-medium">{label}</p>
      <p className="text-3xl font-bold text-slate-800 mt-1">{value}</p>
      {description && (
        <p className="text-xs text-slate-400 mt-1">{description}</p>
      )}
    </div>
  );
}
