const express = require('express');
const fs = require('fs');
const cors = require('cors');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const bodyParser = require('body-parser');
const path = require('path');//The built-in path module helps you conveniently manage file paths 

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(bodyParser.json());// Configure the request body parser

mongoose.connect(process.env.MONGODB_URL)
  .then(async () => {
    console.log('MongoDB connected');

    //  Cleaning all collections
    await mongoose.connection.collection('parsedentries').deleteMany({});
    await mongoose.connection.collection('tasks').deleteMany({});// appendix2

    console.log(' Cleared collections parsedentries and tasks');

    // Import appendix2.json
    await importAppendix2();
  })
  .catch(err => console.error('MongoDB error:', err));

// Schemas
const taskSchema = new mongoose.Schema({
  projectId: Number,
  projectName: String,
  taskName: String,
  owner: String,
  month: String,
});
const Task = mongoose.model('Task', taskSchema);


// These are time entries that a person has entered.
const ParsedEntry = mongoose.model('ParsedEntry', new mongoose.Schema({
  date: String,
  start: String,
  end: String,
  task: String,           // name from the database
  description: String,    // what was actually done
  owner: String,
  project: String
}, { timestamps: true }));// automatically adds the creation date

// Month map
const MONTHS = {
  "Januar": "01", "Februar": "02", "März": "03", "April": "04", "Mai": "05",
  "Juni": "06", "Juli": "07", "August": "08", "September": "09",
  "Oktober": "10", "November": "11", "Dezember": "12"
};

// This function finds the name of the month in a string
function extractMonth(text) {
  const match = text.match(/(Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)'?25/);
  //2025-02 
  return match ? `2025-${MONTHS[match[1]]}` : null;
}

// Recursive function context- projectId and name
function traverse(node, context = {}, allTasks = []) {
  if (node.name) {
    const m = extractMonth(node.name);//if node.name is not a month we are stopped here and dont go to next step
    if (m) context.currentMonth = m; //in context our month
  }

  if (node.subtasks && Array.isArray(node.subtasks)) {
    for (const sub of node.subtasks) {
      traverse(sub, { ...context }, allTasks);
    }
  } else if (!node.subtasks) {
    const ownerMatch = node.name.match(/^\((\w{2})\)/);
    const owner = ownerMatch ? ownerMatch[1] : null;

    //collect
    allTasks.push({
      projectId: context.projectId,
      projectName: context.projectName,
      taskName: node.name,
      owner,
      month: context.currentMonth || null
    });
  }
  return allTasks;
}

// import  appendix2.json The function reads the file, retrieves projects and tasks, goes through them and saves them in MongoDB.
async function importAppendix2() {
  const jsonPath = path.join(__dirname, 'appendix2.json');
  const appendix2 = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const allTasks = [];

  for (const project of appendix2.projects) {
    const context = {
      projectId: project.id,
      projectName: project.name
    };
    for (const task of project.Tasks) {
      traverse(task, context, allTasks);
    }
  }

  await Task.deleteMany({});
  await Task.insertMany(allTasks);// mongoose function 
  console.log(`Imported ${allTasks.length} tasks from appendix2.json`);
}


app.get('/api/saved', async (req, res) => {
  try {
    const entries = await ParsedEntry.find().lean();
    res.json(entries);
  } catch (err) {
    console.error(" Failed to fetch saved entries:", err);
    res.status(500).json({ error: "Failed to fetch saved entries" });
  }
});


// Ollama
async function askOllama(prompt) {
  const response = await fetch('http://127.0.0.1:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gemma3:4b', prompt, stream: false })
  });
  const data = await response.json();
  console.log(data.response)
  return data.response;
}

// Processing rawText
app.post('/api/parse', async (req, res) => {
  const { rawText } = req.body;
  if (!rawText) return res.status(400).json({ error: 'Missing rawText' });

  try {
    // Step 1: get owner and  month
    const metaPrompt = `
Extract the employee's initials and the month in the format YYYY-MM from this time tracking input.

Return JSON like:
{
  "owner": "ML",
  "month": "2025-04"
}

Text:
${rawText}
    `;
    console.log(" promt 1 " + metaPrompt)
    const metaRaw = await askOllama(metaPrompt);
    console.log("answer 1 ", metaRaw)
    const metaMatch = metaRaw.match(/\{[\s\S]*?\}/);
    if (!metaMatch) return res.status(400).json({ error: 'Failed to extract metadata' });

    const { owner, month } = JSON.parse(metaMatch[0]);
    if (!owner || !month) return res.status(400).json({ error: 'Incomplete metadata' });

    // Step 2:  filter tasks

    const tasks = await Task.find({ owner, month }).lean();

    // Grouping by projects
    /*     [
      {
        "projectId": 1258,
        "projectName": "1258 - PDM - Produkt - Anwendungen - 2025",
        "tasks": [
          {
            "taskName": "(SK) - BuP - April'25",
            "owner": "SK",
            "month": "2025-04"
          }
        ]
      },
      {
        "projectId": 1260,
        "projectName": "1260 - PDM - Produkt - Horizont - 2025",
        "tasks": [
          {
            "taskName": "(SK) - BuP - April'25",
            "owner": "SK",
            "month": "2025-04"
          }
        ]
      }
    ] */
    const groupedProjects = {};
    for (const task of tasks) {
      if (!groupedProjects[task.projectName]) {
        groupedProjects[task.projectName] = {
          projectId: task.projectId,
          projectName: task.projectName,
          tasks: []
        };
      }
      groupedProjects[task.projectName].tasks.push({
        taskName: task.taskName,
        owner: task.owner,
        month: task.month
      });
    }
    const fullContext = Object.values(groupedProjects);//context

    // Step 3: main system prompt
    const systemPrompt = `
You are a precise JSON parser that extracts structured time tracking data from unstructured employee entries.

Each entry describes a work session. You must extract a clean JSON array of objects representing structured time tracking records.

You are also given a list of known projects and their associated tasks from the database:
${JSON.stringify(fullContext, null, 2)}

Your task is to:
1. Extract date, time, description from the employee input.
2. Determine which known task and project it most likely corresponds to.
3. For the field "task", use the official task name from the database (e.g., "(TS) - BD - April'25").
4. For the field "description", use the original free-text description (e.g., "Figma-Export Konzept").
5. Match tasks and projects based on logical similarity, not just exact matches.
6. If task or project cannot be identified, use null.

### Output format:
[
  {
    "date": "YYYY-MM-DD",        // Date of the entry
    "start": "HH:MM",            // Start time
    "end": "HH:MM",              // End time
    "task": "Official task name",// Name from database
    "description": "What was actually done", // Free text from input
    "owner": "TS",               // Employee initials
    "project": "Project name"    // Full project name from database
  }
]

⚠️ Rules:
- Return only the JSON array.
- Do not include markdown, comments, or explanation.
- Always try to match a task and project logically.
- Use only known values for "task" and "project".

Now analyze the input and return the result.
`;


    const finalPrompt = `${systemPrompt}\n\nInput:\n${rawText}`;
    console.log("raw promt 2 " + finalPrompt)
    const fullResponse = await askOllama(finalPrompt);
    console.log("answer2 " + fullResponse)
    let match = fullResponse.match(/```json\s*([\s\S]*?)\s*```/);
    if (!match) {
      match = fullResponse.match(/\[\s*\{[\s\S]*?\}\s*\]/);
    }

    if (!match) {
      console.error(' JSON block not found in response');
      return res.status(500).json({ error: 'No JSON block found in Ollama response' });
    }

    const clean = match[1] || match[0];
    const parsed = JSON.parse(clean);

    res.json({ parsed });
  } catch (err) {
    console.error(' Parse error:', err);
    res.status(500).json({ error: 'Failed to parse data' });
  }
});

// Saving the results
app.post('/api/save', async (req, res) => {
  const { entries } = req.body;

  if (!Array.isArray(entries)) {
    return res.status(400).json({ error: 'Invalid or missing entries array' });
  }

  try {
    const saved = await ParsedEntry.insertMany(entries);
    res.status(201).json({ message: 'Entries saved successfully', saved });
  } catch (err) {
    console.error(' Failed to save parsed entries:', err);
    res.status(500).json({ error: 'Failed to save entries to MongoDB' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
