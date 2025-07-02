import { useState, useEffect } from "react";
import axios from "axios";

function App() {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState([]);
  const [savedTasks, setSavedTasks] = useState([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasSaved, setHasSaved] = useState(false);

  const handleParse = async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await axios.post("http://localhost:3001/api/parse", { rawText: text });//We send text to the server at /api/parse, and the server returns a parsed array.
      setParsed(res.data.parsed || []);
      setMessage("Parsed successfully");
      setHasSaved(false);
    } catch (err) {
      console.error("Parse error:", err);
      setMessage("Parsing failed");
    } finally {
      setLoading(false);
    }
  };

  //Called when the ‘Save’ button is pressed.
  const handleSave = async () => {
    setLoading(true);
    setMessage("");
    try {
      await axios.post("http://localhost:3001/api/save", { entries: parsed });//We send the parsed array to the server for storage.
      setMessage("Saved to DB");
      setHasSaved(true);
      fetchSavedTasks();
    } catch (err) {
      console.error("Save error:", err);
      setMessage("Saving failed");
    } finally {
      setLoading(false);
    }
  };
//We retrieve all saved tasks from the server.
  const fetchSavedTasks = async () => {
    try {
      const res = await axios.get("http://localhost:3001/api/saved");
      const grouped = res.data.reduce((acc, task) => {
        if (!acc[task.date]) acc[task.date] = [];
        acc[task.date].push(task);
        return acc;
      }, {});
      setSavedTasks(grouped);
    } catch (err) {
      console.error("Fetch saved tasks error:", err);
    }
  };

  useEffect(() => {
    fetchSavedTasks();
  }, []); //When the component is launched for the first time, fetchSavedTasks is called.


  //When the user changes a field (e.g., date), we update the necessary value in the parsed array.
  const handleChange = (idx, field, value) => {
    const updated = [...parsed];
    updated[idx][field] = value;
    setParsed(updated);
  };

  return (
    <div className="min-h-screen p-6 bg-gray-100">
      <h1 className="text-2xl font-bold mb-4">Time Tracking Parser</h1>
      <textarea
        rows="10"
        className="w-full p-2 border rounded mb-4"
        placeholder="Paste time tracking text here..."
        value={text}
        onChange={(e) => setText(e.target.value)}
      ></textarea>
      <div className="flex gap-4 mb-6">
        <button onClick={handleParse} className="bg-blue-600 text-white px-4 py-2 rounded">Parse</button>
        <button onClick={handleSave} className="bg-green-600 text-white px-4 py-2 rounded">Save</button>
      </div>

      {loading && <p className="text-sm text-gray-500 mb-4">Loading...</p>}
      {message && <p className="text-sm text-gray-700 mb-4">{message}</p>}

      {!hasSaved && (
        <div className="space-y-4 mb-12">
          {parsed.map((entry, idx) => (
            <div key={idx} className="bg-white p-4 rounded shadow space-y-2">
              <input
                type="text"
                className="w-full border p-2 rounded"
                value={entry.date}
                onChange={(e) => handleChange(idx, "date", e.target.value)}
                placeholder="Date"
              />
              <input
                type="text"
                className="w-full border p-2 rounded"
                value={entry.start}
                onChange={(e) => handleChange(idx, "start", e.target.value)}
                placeholder="Start Time"
              />
              <input
                type="text"
                className="w-full border p-2 rounded"
                value={entry.end}
                onChange={(e) => handleChange(idx, "end", e.target.value)}
                placeholder="End Time"
              />
              <input
                type="text"
                className="w-full border p-2 rounded"
                value={entry.task}
                onChange={(e) => handleChange(idx, "task", e.target.value)}
                placeholder="Task"
              />
              <input
                type="text"
                className="w-full border p-2 rounded"
                value={entry.description || ""}
                onChange={(e) => handleChange(idx, "description", e.target.value)}
                placeholder="Description"
              />
              <input
                type="text"
                className="w-full border p-2 rounded"
                value={entry.owner}
                onChange={(e) => handleChange(idx, "owner", e.target.value)}
                placeholder="Owner"
              />
              <input
                type="text"
                className="w-full border p-2 rounded"
                value={entry.project}
                onChange={(e) => handleChange(idx, "project", e.target.value)}
                placeholder="Project"
              />
            </div>
          ))}
        </div>
      )}

      <h2 className="text-xl font-bold mb-2">Saved Tasks</h2>
      <div className="space-y-6">
        {Object.keys(savedTasks).sort().map((date) => (
          <div key={date} className="bg-white p-4 rounded shadow">
            <h3 className="text-lg font-semibold mb-2">{date}</h3>
            <ul className="space-y-2">
              {savedTasks[date].sort((a, b) => a.start.localeCompare(b.start)).map((task, idx) => (
                <li key={idx} className="border p-2 rounded">
                  <div><strong>{task.start} – {task.end}</strong>: {task.task}</div>
                  <div className="text-sm text-gray-500">{task.description}</div>
                  <div className="text-sm">👤 {task.owner} | 📁 {task.project}</div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;