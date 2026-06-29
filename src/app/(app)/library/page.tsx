import LibrarySection from '@/components/sections/LibrarySection'
import ClipLibrarySection from '@/components/sections/ClipLibrarySection'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

export default function LibraryPage() {
  return (
    <Tabs defaultValue="knowledge">
      <div className="container mx-auto max-w-6xl px-4 pt-8 lg:px-6 lg:pt-10">
        <TabsList>
          <TabsTrigger value="knowledge">Knowledge Library</TabsTrigger>
          <TabsTrigger value="clips">Clip Library</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="knowledge" className="mt-0">
        <LibrarySection />
      </TabsContent>
      <TabsContent value="clips" className="mt-0">
        <ClipLibrarySection />
      </TabsContent>
    </Tabs>
  )
}
