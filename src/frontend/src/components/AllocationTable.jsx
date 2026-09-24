import React, { useEffect, useState } from 'react';
import { getAllocations } from '../services/api';

export default function AllocationTable() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => { fetchData(); }, []);
  const fetchData = async () => {
    setLoading(true);
    const res = await getAllocations();
    if (res.error) setError(res.error); else setData(res.data);
    setLoading(false);
  };

  if (loading) return <div className="h-64 animate-pulse bg-gray-200 rounded-lg"></div>;
  if (error) return <div className="text-red-500">Error: {error}</div>;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="p-4 border-b border-gray-100">
        <h3 className="font-semibold text-gray-800">Resource Allocations</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left text-gray-500">
          <thead className="text-xs text-gray-700 bg-gray-50 uppercase">
            <tr><th className="px-6 py-3">Resource ID</th><th className="px-6 py-3">Service</th><th className="px-6 py-3">Capacity</th><th className="px-6 py-3">Status</th></tr>
          </thead>
          <tbody>
            {data.map((item, idx) => (
              <tr key={idx} className="bg-white border-b hover:bg-gray-50">
                <td className="px-6 py-4 font-medium text-gray-900">{item.resourceId}</td><td className="px-6 py-4">{item.service}</td><td className="px-6 py-4">{item.capacity}</td>
                <td className="px-6 py-4">
                  <span className={\px-2 py-1 rounded-full text-xs font-semibold \\}>{item.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
