// tests/parser.test.ts

function parseCustomVariables(
  content: string,
): { raw: string; name: string; type: string; options: string[] }[] {
  const variableRegex =
    /\{\{([a-zA-Z0-9_]+)(?::([a-zA-Z0-9_]+))?(?::([^}]+))?\}\}/g;
  const matches: {
    raw: string;
    name: string;
    type: string;
    options: string[];
  }[] = [];
  const seen = new Set<string>();

  const systemVars = [
    "date",
    "time",
    "datetime",
    "year",
    "month",
    "day",
    "timestamp",
    "clipboard",
    "cursor",
    "caret",
  ];

  let match;
  variableRegex.lastIndex = 0;
  while ((match = variableRegex.exec(content)) !== null) {
    const raw = match[0];
    const name = match[1];
    const type = match[2] || "text";
    const optionsStr = match[3] || "";

    if (systemVars.includes(name.toLowerCase())) {
      continue;
    }

    if (!seen.has(raw)) {
      seen.add(raw);
      const options = optionsStr
        ? optionsStr
            .split(",")
            .map((o) => o.trim())
            .filter(Boolean)
        : [];
      matches.push({ raw, name, type, options });
    }
  }
  return matches;
}

describe("TypeWise Custom Variables Parser", () => {
  it("should extract custom text variables", () => {
    const content = "Hello {{name:text}}, welcome to the company!";
    const result = parseCustomVariables(content);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      raw: "{{name:text}}",
      name: "name",
      type: "text",
      options: [],
    });
  });

  it("should extract custom choice variables with comma-separated options", () => {
    const content = "Choose your city: {{city:choice:London, Paris, Berlin}}";
    const result = parseCustomVariables(content);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      raw: "{{city:choice:London, Paris, Berlin}}",
      name: "city",
      type: "choice",
      options: ["London", "Paris", "Berlin"],
    });
  });

  it("should ignore standard system variables", () => {
    const content = "Today is {{date}} at {{time}}. Clipboard has {{clipboard}}.";
    const result = parseCustomVariables(content);
    expect(result).toHaveLength(0);
  });

  it("should ignore cursor positioning placeholders", () => {
    const content = "Insert text here {{cursor}} or {{caret}}";
    const result = parseCustomVariables(content);
    expect(result).toHaveLength(0);
  });

  it("should extract multiple distinct custom variables", () => {
    const content = "Hi {{name}}, your subscription for {{plan:choice:Basic, Pro}} expires soon.";
    const result = parseCustomVariables(content);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      raw: "{{name}}",
      name: "name",
      type: "text",
      options: [],
    });
    expect(result[1]).toEqual({
      raw: "{{plan:choice:Basic, Pro}}",
      name: "plan",
      type: "choice",
      options: ["Basic", "Pro"],
    });
  });
});
